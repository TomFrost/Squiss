/*
 * Copyright (c) 2015 TechnologyAdvice
 */

import AWS from 'aws-sdk';
import { EventEmitter } from 'events';
import Message from './Message';
import url from 'url';

/**
 * Option defaults.
 * @type {{receiveBatchSize: number, receiveWaitTimeSecs: number, deleteBatchSize: number, deleteWaitMs: number,
 *   maxInFlight: number, unwrapSns: boolean, msgFormat: string, correctQueueUrl: boolean}}
 */
const optDefaults = {
  receiveBatchSize: 10,
  receiveWaitTimeSecs: 20,
  deleteBatchSize: 10,
  deleteWaitMs: 2000,
  maxInFlight: 100,
  unwrapSns: false,
  bodyFormat: 'plain',
  correctQueueUrl: false
};

/**
 * Squiss is a high-volume-capable Amazon SQS polling class. See README for usage details.
 */
export default class Squiss extends EventEmitter {

  /**
   * Creates a new Squiss object.
   * @param {Object} opts A map of options to configure this instance
   * @param {Object} [opts.awsConfig] An object mapping to pass to the SQS constructor, configuring the
   *    aws-sdk library. This is commonly used to set the AWS region, or the user credentials. See
   *    http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html
   * @param {string} [opts.queueUrl] The URL of the queue to be polled. If not specified, opts.queueName is
   *    required.
   * @param {string} [opts.queueName] The name of the queue to be polled. Used only if opts.queueUrl is not
   *    specified.
   * @param {string} [opts.accountNumber] If a queueName is specified, the accountNumber of the queue
   *    owner can optionally be specified to access a queue in a different AWS account.
   * @param {boolean} [opts.correctQueueUrl=false] Changes the protocol, host, and port of the queue URL to match the
   *    configured SQS endpoint, applicable only if opts.queueName is specified. This can be useful for testing against
   *    a stubbed SQS service, such as ElasticMQ.
   * @param {number} [opts.deleteBatchSize=10] The number of messages to delete at one time. Squiss will trigger a
   *    batch delete when this limit is reached, or when deleteWaitMs milliseconds have passed since the first queued
   *    delete in the batch; whichever comes first. Set to 1 to make all deletes immediate. Maximum 10.
   * @param {number} [opts.deleteWaitMs=2000] The number of milliseconds to wait after the first queued message
   *    deletion before deleting the message(s) from SQS
   * @param {number} [opts.maxInFlight=100] The number of messages to keep "in-flight", or processing simultaneously.
   *    When this cap is reached, no more messages will be polled until currently in-flight messages are marked as
   *    deleted or handled. Setting this to 0 will uncap your inFlight messages, pulling and delivering messages
   *    as long as there are messages to pull.
   * @param {number} [opts.receiveBatchSize=10] The number of messages to receive at one time. Maximum 10 or
   *    maxInFlight, whichever is lower.
   * @param {number} [opts.receiveWaitTimeSecs=20] The number of seconds for which to hold open the SQS call to
   *    receive messages, when no message is currently available. It is recommended to set this high, as Squiss will
   *    re-open the receiveMessage HTTP request as soon as the last one ends. Maximum 20.
   * @param {boolean} [opts.unwrapSns=false] Set to `true` to denote that Squiss should treat each message as though
   *    it comes from a queue subscribed to an SNS endpoint, and automatically extract the message from the SNS
   *    metadata wrapper.
   * @param {string} [opts.bodyFormat="plain"] The format of the incoming message. Set to "json" to automatically call
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
    this._maxInFlight = opts.maxInFlight || opts.maxInFlight === 0 ?  opts.maxInFlight : optDefaults.maxInFlight;
    this._receiveBatchSize = Math.min(opts.receiveBatchSize || optDefaults.receiveBatchSize, this._maxInFlight, 10);
    this._unwrapSns = opts.hasOwnProperty('unwrapSns') ? opts.unwrapSns : optDefaults.unwrapSns;
    this._bodyFormat = opts.bodyFormat || optDefaults.bodyFormat;
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
    this._correctQueueUrl = opts.correctQueueUrl || optDefaults.correctQueueUrl;
    if (opts.visibilityTimeout) {
      this._sqsParams.VisibilityTimeout = opts.visibilityTimeout;
    }
    if (!opts.queueUrl && !opts.queueName) {
      throw new Error('Squiss requires either the "queueUrl", or the "queueName".');
    }
    if (!opts.queueUrl) {
      this._getQueueUrl(opts.queueName, opts.accountNumber);
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
   * Starts the poller. If this instance is still retrieving the queueUrl, Squiss will automatically
   * re-call this function when the queueUrl has been set up.
   */
  start() {
    if (this._urlWaiting) {
      this.on('ready', () => this.start());
    } else if (!this._running) {
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
      } else if (data.Failed && data.Failed.length) {
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
      if (data && data.Messages) {
        data.Messages.forEach((msg) => {
          const message = new Message({
            squiss: this,
            unwrapSns: this._unwrapSns,
            bodyFormat: this._bodyFormat,
            msg
          });
          this._inFlight++;
          this.emit('message', message);
        });
      } else {
        this.emit('queueEmpty');
      }
      if (this._running && this._slotsAvailable()) {
        this._getBatch();
      }
    });
  }

  /**
   * Gets the queueUrl for a given queue and sets this instance up to use it. Any calls to
   * {@link #start} will wait until this function completes to begin polling.
   *
   * Emits `ready` when the queueUrl is retrieved and set up; `error` if the AWS GetQueueURL
   * call fails.
   * @param {string} queueName The name of the queue for which to retrieve the URL
   * @param {string} [accountNumber] Optionally, the AWS account number of the queue owner
   * @private
   */
  _getQueueUrl(queueName, accountNumber) {
    this._urlWaiting = true;
    const params = { QueueName: queueName };
    if (accountNumber) {
      params.QueueOwnerAWSAccountId = accountNumber;
    }
    this.sqs.getQueueUrl(params, (err, data) => {
      if (err) this.emit('error', err);
      else {
        this._urlWaiting = false;
        let queueUrl = data.QueueUrl;
        if (this._correctQueueUrl) {
          let newUrl = url.parse(this.sqs.config.endpoint);
          const parsedQueueUrl = url.parse(queueUrl);
          newUrl.pathname = parsedQueueUrl.pathname;
          queueUrl = url.format(newUrl);
        }
        this._queueUrl = queueUrl;
        this._sqsParams.QueueUrl = queueUrl;
        this.emit('ready');
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
    return !this._maxInFlight || this._inFlight <= this._maxInFlight - this._receiveBatchSize;
  }
}
