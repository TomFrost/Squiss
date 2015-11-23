/*
 * Copyright (c) 2015 TechnologyAdvice
 */

import AWS from 'aws-sdk';
import { EventEmitter } from 'events';
import Message from './Message';

/**
 * Option defaults.
 * @type {{receiveBatchSize: number, receiveWaitTimeSecs: number, deleteBatchSize: number, deleteWaitMs: number,
 *   maxInFlight: number, unwrapSns: boolean, msgFormat: string}}
 */
const optDefaults = {
  receiveBatchSize: 10,
  receiveWaitTimeSecs: 20,
  deleteBatchSize: 10,
  deleteWaitMs: 2000,
  maxInFlight: 100,
  unwrapSns: false,
  msgFormat: 'plain'
};

/**
 * Squiss is a high-volume-capable Amazon SQS polling class. See README for usage details.
 */
export default class Squiss extends EventEmitter {

  /**
   * Creates a new Squiss object.
   * @param {Object} opts A map of options to configure this instance
   * @param {string} opts.queueUrl The URL of the queue to be polled
   * @param {number} [opts.deleteBatchSize=10] The number of messages to delete at one time. Squiss will trigger a
   *    batch delete when this limit is reached, or when deleteWaitMs milliseconds have passed since the first queued
   *    delete in the batch; whichever comes first. Set to 1 to make all deletes immediate. Maximum 10.
   * @param {number} [opts.deleteWaitMs=2000] The number of milliseconds to wait after the first queued message
   *    deletion before deleting the message(s) from SQS
   * @param {number} [opts.maxInFlight=100] The number of messages to keep "in-flight", or processing simultaneously.
   *    When this cap is reached, no more messages will be polled until currently in-flight messages are marked as
   *    deleted or handled.
   * @param {number} [opts.receiveBatchSize=10] The number of messages to receive at one time. Maximum 10 or
   *    maxInFlight, whichever is lower.
   * @param {number} [opts.receiveWaitTimeSecs=20] The number of seconds for which to hold open the SQS call to
   *    receive messages, when no message is currently available. It is recommended to set this high, as Squiss will
   *    re-open the receiveMessage HTTP request as soon as the last one ends. Maximum 20.
   * @param {boolean} [opts.unwrapSns=false] Set to `true` to denote that Squiss should treat each message as though
   *    it comes from a queue subscribed to an SNS endpoint, and automatically extract the message from the SNS
   *    metadata wrapper.
   * @param {string} [opts.msgFormat="plain"] The format of the incoming message. Set to "json" to automatically call
   *    `JSON.parse()` on each incoming message.
   * @param {number} [opts.visibilityTimeout] The SQS VisibilityTimeout to apply to each message. This is the number of
   *    seconds that each received message should be made inaccessible to other receive calls, so that a message will
   *    not be received more than once before it is processed and deleted. If not specified, the default for the SQS
   *    queue will be used.
   */
  constructor(opts = {}) {
    super();
    this.sqs = new AWS.SQS(opts.awsConfig);
    this._queueUrl = opts.queueUrl;
    this._deleteBatchSize = Math.min(opts.deleteBatchSize || optDefaults.deleteBatchSize, 10);
    this._deleteWaitMs = opts.deleteWaitMs || optDefaults.deleteWaitMs;
    this._maxInFlight = opts.maxInFlight || optDefaults.maxInFlight;
    this._receiveBatchSize = Math.min(opts.receiveBatchSize || optDefaults.receiveBatchSize, this._maxInFlight, 10);
    this._unwrapSns = opts.hasOwnProperty('unwrapSns') ? opts.unwrapSns : optDefaults.unwrapSns;
    this._msgFormat = opts.msgFormat || optDefaults.msgFormat;
    this._requesting = false;
    this._running = false;
    this._inFlight = 0;
    this._delQueue = [];
    this._delTimer = null;
    this._sqsParams = {
      QueueUrl: opts.queueUrl,
      MaxNumberOfMessages: this._receiveBatchSize,
      WaitTimeSeconds: opts.receiveWaitTimeSecs || optDefaults.receiveWaitTimeSecs
    };
    if (opts.visibilityTimeout) {
      this._sqsParams.VisibilityTimeout = opts.visibilityTimeout;
    }
    if (!opts.queueUrl) {
      throw new Error('Squiss requires a "queueUrl" option in the constructor');
    }
  }

  /**
   * Getter for the number of messages currently in flight.
   * @returns {number}
   */
  get inFlight() {
    return this._inFlight;
  }

  /**
   * Getter to determine whether Squiss is currently polling or not.
   * @returns {boolean}
   */
  get running() {
    return this._running;
  }

  /**
   * Queues the given message for deletion. The message will actually be deleted from SQS per the settings
   * supplied to the constructor.
   * @param {Message} msg The message to be deleted.
   */
  deleteMessage(msg) {
    this._delQueue.push({ Id: msg.raw.MessageId, ReceiptHandle: msg.raw.ReceiptHandle });
    this.handledMessage();
    if (this._delQueue.length >= this._deleteBatchSize) {
      if (this._delTimer) {
        clearTimeout(this._delTimer);
        this._delTimer = null;
      }
      const delBatch = this._delQueue.splice(0, this._deleteBatchSize);
      this._deleteMessages(delBatch);
    } else if (!this._delTimer) {
      this._delTimer = setTimeout(() => {
        const delBatch = this._delQueue.splice(0, this._delQueue.length);
        this._deleteMessages(delBatch);
      }, this._deleteWaitMs);
    }
  }

  /**
   * Informs Squiss that a message has been handled. This allows Squiss to decrement the number of in-flight
   * messages without deleting one, which may be necessary in the event of an error.
   */
  handledMessage() {
    this._inFlight--;
    if (this._running && this._slotsAvailable()) {
      this._getBatch();
    }
    if (!this._inFlight) {
      this.emit('drained');
    }
  }

  /**
   * Starts the poller.
   */
  start() {
    if (!this._running) {
      this._running = true;
      this._getBatch();
    }
  }

  /**
   * Stops the poller.
   */
  stop() {
    this._running = false;
  }

  /**
   * Deletes a batch of messages (maximum 10) from Amazon SQS.  If there is an error making the call to SQS, the
   * `error` event will be emitted with an Error object. If SQS reports any issue deleting any of the messages,
   * the `delError` event will be emitted with the failure object passed back by the AWS SDK.
   * @param {Array<{Id: string, ReceiptHandle: string}>} batch The batch of messages to be deleted, in the format
   *    required for sqs.deleteMessageBatch's Entries parameter.
   * @private
   */
  _deleteMessages(batch) {
    const delParams = {
      QueueUrl: this._queueUrl,
      Entries: batch
    };
    this.sqs.deleteMessageBatch(delParams, (err, data) => {
      if (err) {
        this.emit('error', err);
      }
      if (data.Failed && data.Failed.length) {
        data.Failed.forEach((fail) => this.emit('delError', fail));
      }
    });
  }

  /**
   * Gets a new batch of messages from Amazon SQS. Note that this function does no checking of the current inFlight
   * count, or the current running status. A `message` event will be emitted for each new message, with the provided
   * object being an instance of Squiss' Message class.
   * @private
   */
  _getBatch() {
    if (this._requesting) return;
    this._requesting = true;
    this.sqs.receiveMessage(this._sqsParams, (err, data) => {
      this._requesting = false;
      if (err) {
        this.emit('error', err);
        return;
      }
      data.Messages.forEach((msg) => {
        const message = new Message({
          squiss: this,
          unwrapSns: this._unwrapSns,
          msgFormat: this._msgFormat,
          msg
        });
        this._inFlight++;
        this.emit('message', message);
      });
      if (this._running && this._slotsAvailable()) {
        this._getBatch();
      }
    });
  }

  /**
   * Determines if there are enough available slots to receive another batch of messages from Amazon SQS without going
   * over the maxInFlight limit set in the constructor options.
   * @returns {boolean}
   * @private
   */
  _slotsAvailable() {
    return this._inFlight < this._maxInFlight - this._receiveBatchSize;
  }
}
