/*
 * Copyright (c) 2015 TechnologyAdvice
 */

import AWS from 'aws-sdk';
import { EventEmitter } from 'events';
import Message from './Message';

const optDefaults = {
  receiveBatchSize: 10,
  receiveWaitTimeSecs: 20,
  deleteBatchSize: 10,
  deleteWaitMs: 2000,
  maxInFlight: 100,
  unwrapSns: false,
  msgFormat: 'plain'
};

export class Squiss extends EventEmitter {
  constructor(opts = {}) {
    this.sqs = new AWS.SQS(opts.awsConfig);
    this._queue = opts.queue;
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
      QueueUrl: opts.queue,
      MaxNumberOfMessages: this._receiveBatchSize,
      WaitTimeSeconds: opts.receiveWaitTimeSecs || optDefaults.receiveWaitTimeSecs
    };
    if (opts.visibilityTimeout) {
      this._sqsParams.VisibilityTimeout = opts.visibilityTimeout;
    }
    if (!opts.queue) {
      throw new Error('Squiss requires a "queue" option in the constructor');
    }
  }

  get inFlight() {
    return this._inFlight;
  }

  get running() {
    return this._running;
  }

  deleteMessage(msg) {
    this._delQueue.push({ Id: msg.raw.MessageId, ReceiptHandle: msg.raw.ReceiptHandle });
    this.handledMessage();
    if (this._delTimer !== null) clearTimeout(this._delTimer);
    if (this._delQueue.length > this._deleteBatchSize) {
      const delBatch = this._delQueue.splice(0, this._deleteBatchSize);
      this._deleteMessages(delBatch);
    } else {
      this._delTimer = setTimeout(() => {
        const delBatch = this._delQueue.splice(0, this._delQueue.length);
        this._deleteMessages(delBatch);
      }, this._deleteWaitMs);
    }
  }

  handledMessage() {
    this._inFlight--;
    if (this._running || this._slotsAvailable()) {
      this._getBatch();
    }
    if (!this._inFlight) {
      this.emit('drained');
    }
  }

  start() {
    if (!this._running) {
      this._getBatch();
    }
  }

  stop() {
    this._running = false;
  }

  _deleteMessages(batch) {
    const delParams = {
      QueueUrl: this._queue,
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
      if (this._slotsAvailable()) {
        this._getBatch();
      }
    });
  }

  _slotsAvailable() {
    return this._inFlight < this._maxInFlight - this._receiveBatchSize;
  }
}
