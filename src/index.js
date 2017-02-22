/*
 * Copyright (c) 2015-2016 TechnologyAdvice
 */

'use strict'

const AWS = require('aws-sdk')
const EventEmitter = require('events').EventEmitter
const Message = require('./Message')
const url = require('url')

/**
 * The maximum number of messages that can be sent in an SQS sendMessageBatch request.
 * @type {number}
 */
const AWS_MAX_SEND_BATCH = 10

/**
 * Option defaults.
 * @type {Object}
 */
const optDefaults = {
  receiveBatchSize: 10,
  receiveWaitTimeSecs: 20,
  deleteBatchSize: 10,
  deleteWaitMs: 2000,
  maxInFlight: 100,
  unwrapSns: false,
  bodyFormat: 'plain',
  correctQueueUrl: false,
  pollRetryMs: 2000,
  activePollIntervalMs: 0,
  idlePollIntervalMs: 0,
  delaySecs: 0,
  maxMessageBytes: 262144,
  messageRetentionSecs: 345600
}

/**
 * Squiss is a high-volume-capable Amazon SQS polling class. See README for usage details.
 */
class Squiss extends EventEmitter {

  /**
   * Creates a new Squiss object.
   * @param {Object} opts A map of options to configure this instance
   * @param {Function} [opts.SQS] An SQS constructor function to use rather than the default one provided by SQS
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
   * @param {number} [opts.visibilityTimeoutSecs] The SQS VisibilityTimeout to apply to each message. This is the
   *    number of seconds that each received message should be made inaccessible to other receive calls, so that a
   *    message will not be received more than once before it is processed and deleted. If not specified, the default
   *    for the SQS queue will be used when receiving messages, and the SQS default (30) will be used when creating a
   *    queue.
   * @param {number} [opts.pollRetryMs=2000] The number of milliseconds to wait before retrying when Squiss's call to
   *    retrieve messages from SQS fails.
   * @param {number} [opts.activePollIntervalMs=0] The number of milliseconds to wait between requesting batches of
   *    messages when the queue is not empty, and the maxInFlight cap has not been hit.
   * @param {number} [opts.idlePollIntervalMs=0] The number of milliseconds to wait before requesting a batch of
   *    messages when the queue was empty on the prior request.
   * @param {number} [opts.delaySecs=0] The number of milliseconds by which to delay the delivery of new messages into
   *    the queue by default. This is only used when calling {@link #createQueue}.
   * @param {number} [opts.maxMessageBytes=262144] The maximum size of a single message, in bytes, that the queue can
   *    support. This is only used when calling {@link #createQueue}. Default is the maximum, 256KB.
   * @param {number} [opts.messageRetentionSecs=345600] The amount of time for which to retain messages in the queue
   *    until they expire, in seconds. This is only used when calling {@link #createQueue}. Default is equivalent to
   *    4 days, maximum is 1209600 (14 days).
   * @param {Object} [opts.queuePolicy] If specified, will be set as the access policy of the queue when
   *    {@link #createQueue} is called. See http://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html for
   *    more information.
   */
  constructor(opts) {
    super()
    opts = opts || {}
    this.sqs = opts.SQS ? new opts.SQS(opts.awsConfig) : new AWS.SQS(opts.awsConfig)
    this._opts = {}
    Object.assign(this._opts, optDefaults, opts)
    this._opts.deleteBatchSize = Math.min(this._opts.deleteBatchSize, 10)
    this._opts.receiveBatchSize = Math.min(this._opts.receiveBatchSize,
      this._opts.maxInFlight > 0 ? this._opts.maxInFlight : 10, 10)
    this._running = false
    this._inFlight = 0
    this._delQueue = []
    this._delTimer = null
    this._queueUrl = opts.queueUrl
    if (!opts.queueUrl && !opts.queueName) {
      throw new Error('Squiss requires either the "queueUrl", or the "queueName".')
    }
  }

  /**
   * Getter for the number of messages currently in flight.
   * @returns {number}
   */
  get inFlight() {
    return this._inFlight
  }

  /**
   * Getter to determine whether Squiss is currently polling or not.
   * @returns {boolean}
   */
  get running() {
    return this._running
  }

  /**
   * Changes the visibility timeout of a message.
   * @param {Message|string} msg The Message object or ReceiptHandle for which to change the VisibilityTimeout.
   * @param {number} timeoutInSeconds Visibility timeout in seconds.
   * @returns {Promise} Resolves on complete. Rejects with the official AWS SDK's error object.
   */
  changeMessageVisibility(msg, timeoutInSeconds) {
    let receiptHandle = msg
    if (msg instanceof Message) {
      receiptHandle = msg.raw.ReceiptHandle
    }

    return this.getQueueUrl().then((queueUrl) =>
      this.sqs.changeMessageVisibility({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: timeoutInSeconds
      }).promise()
    )
  }

  /**
   * Creates the configured queue in Amazon SQS and retrieves its queue URL. Note that this method can only be called
   * if Squiss was instantiated with the queueName property.
   * @returns {Promise.<string>} Resolves with the URL of the created queue, rejects with the official AWS SDK's
   *    error object.
   */
  createQueue() {
    if (!this._opts.queueName) {
      return Promise.reject(new Error('Squiss was not instantiated with a queueName'))
    }
    const params = {
      QueueName: this._opts.queueName,
      Attributes: {
        ReceiveMessageWaitTimeSeconds: this._opts.receiveWaitTimeSecs.toString(),
        DelaySeconds: this._opts.delaySecs.toString(),
        MaximumMessageSize: this._opts.maxMessageBytes.toString(),
        MessageRetentionPeriod: this._opts.messageRetentionSecs.toString()
      }
    }
    if (this._opts.visibilityTimeoutSecs) {
      params.Attributes.VisibilityTimeout = this._opts.visibilityTimeoutSecs.toString()
    }
    if (this._opts.queuePolicy) {
      params.Attributes.Policy = this._opts.queuePolicy
    }
    return this.sqs.createQueue(params).promise().then(res => {
      this._queueUrl = res.QueueUrl
      return res.QueueUrl
    })
  }

  /**
   * Queues the given message for deletion. The message will actually be deleted from SQS per the settings
   * supplied to the constructor.
   * @param {Message|string} msg The message object to be deleted, or the receipt handle of a message to be deleted
   */
  deleteMessage(msg) {
    if (msg instanceof Message) {
      this._delQueue.push({ Id: msg.raw.MessageId, ReceiptHandle: msg.raw.ReceiptHandle })
    } else {
      this._delQueue.push({ Id: this._delQueue.length.toString(), ReceiptHandle: msg })
    }
    this.handledMessage()
    if (this._delQueue.length >= this._opts.deleteBatchSize) {
      if (this._delTimer) {
        clearTimeout(this._delTimer)
        this._delTimer = null
      }
      const delBatch = this._delQueue.splice(0, this._opts.deleteBatchSize)
      this._deleteMessages(delBatch)
    } else if (!this._delTimer) {
      this._delTimer = setTimeout(() => {
        this._delTimer = null
        const delBatch = this._delQueue.splice(0, this._delQueue.length)
        this._deleteMessages(delBatch)
      }, this._opts.deleteWaitMs)
    }
  }

  /**
   * Deletes the configured queue.
   * @returns {Promise} Resolves on complete. Rejects with the official AWS SDK's error object.
   */
  deleteQueue() {
    return this.getQueueUrl().then((queueUrl) => {
      return this.sqs.deleteQueue({ QueueUrl: queueUrl }).promise()
    })
  }

  /**
   * Gets the queueUrl for the configured queue and sets this instance up to use it. Any calls to
   * {@link #start} will wait until this function completes to begin polling.
   * @returns {Promise.<string>} Resolves with the queue URL
   * @private
   */
  getQueueUrl() {
    if (this._queueUrl) return Promise.resolve(this._queueUrl)
    const params = { QueueName: this._opts.queueName }
    if (this._opts.accountNumber) {
      params.QueueOwnerAWSAccountId = this._opts.accountNumber.toString()
    }
    return this.sqs.getQueueUrl(params).promise().then(data => {
      this._queueUrl = data.QueueUrl
      if (this._opts.correctQueueUrl) {
        let newUrl = url.parse(this.sqs.config.endpoint)
        const parsedQueueUrl = url.parse(this._queueUrl)
        newUrl.pathname = parsedQueueUrl.pathname
        this._queueUrl = url.format(newUrl)
      }
      return this._queueUrl
    })
  }

  /**
   * Informs Squiss that a message has been handled. This allows Squiss to decrement the number of in-flight
   * messages without deleting one, which may be necessary in the event of an error.
   */
  handledMessage() {
    this._inFlight--
    if (this._paused && this._slotsAvailable()) {
      this._paused = false
      this._startPoller()
    }
    if (!this._inFlight) {
      this.emit('drained')
    }
  }

  /**
   * Releases a message back into the queue by changing its VisibilityTimeout to 0 and calling
   * {@link #handledMessage}. Note that if this is used when the poller is running, the message will be
   * immediately picked up and processed again (by this or any other application instance polling the same
   * queue).
   * @param {Message|string} msg The Message object or ReceiptHandle for which to change the VisibilityTimeout.
   * @returns {Promise} Resolves when the VisibilityTimeout has been changed. Rejects with the official AWS SDK's
   * error object.
   */
  releaseMessage(msg) {
    this.handledMessage()
    return this.changeMessageVisibility(msg, 0)
  }

  /**
   * Sends an individual message to the configured queue.
   * @param {string|Object} message The message to be sent. Objects will be JSON.stringified.
   * @param {number} [delay] The number of seconds by which to delay the delivery of the message, max 900. If not
   *    specified, the queue default will be used.
   * @param {Object} [attributes] An optional attributes mapping to associate with the message. For more information,
   *    see http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SQS.html#sendMessage-property.
   * @returns {Promise.<{MessageId: string, MD5OfMessageAttributes: string, MD5OfMessageBody: string}>} Resolves with
   *    the official AWS SDK sendMessage response, rejects with the official error object.
   */
  sendMessage(message, delay, attributes) {
    return this.getQueueUrl().then((queueUrl) => {
      const params = {
        QueueUrl: queueUrl,
        MessageBody: typeof message === 'object' ? JSON.stringify(message) : message
      }
      if (delay) params.DelaySeconds = delay
      if (attributes) params.MessageAttributes = attributes
      return this.sqs.sendMessage(params).promise()
    })
  }

  /**
   * Sends an array of any number of messages to the configured SQS queue, breaking them down into appropriate batch
   * requests executed in parallel (or as much as the default HTTP agent allows). The response is closely aligned to
   * the official AWS SDK's sendMessageBatch response, except the results from all batch requests are merged. Expect
   * a result similar to:
   *
   * {
   *   Successful: [
   *     {Id: string, MessageId: string, MD5OfMessageAttributes: string, MD5OfMessageBody: string}
   *   ],
   *   Failed: [
   *     {Id: string, SenderFault: boolean, Code: string, Message: string}
   *   ]
   * }
   *
   * See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SQS.html#sendMessageBatch-property for full details.
   * The "Id" supplied in the response will be the index of the message in the original messages array, in string form.
   * @param {string|Object||Array<string|Object>} messages An array of messages to be sent. Objects will be
   *    JSON.stringified.
   * @param {number} [delay] The number of seconds by which to delay the delivery of the messages, max 900. If not
   *    specified, the queue default will be used.
   * @param {Object} [attributes] An optional attributes mapping to associate with all messages. For more information,
   *    see http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SQS.html#sendMessageBatch-property.
   * @returns {Promise.<{Successful: Array<{Id: string, MessageId: string, MD5OfMessageAttributes: string,
   *    MD5OfMessageBody: string}>, Failed: Array<{Id: string, SenderFault: boolean, Code: string,
   *    Message: string}>}>} Resolves with successful and failed messages, rejects with API error on critical failure.
   */
  sendMessages(messages, delay, attributes) {
    const batches = []
    const msgs = Array.isArray(messages) ? messages : [messages]
    for (let i = 0; i < msgs.length; i++) {
      if (i % AWS_MAX_SEND_BATCH === 0) batches.push([])
      batches[batches.length - 1].push(msgs[i])
    }
    return Promise.all(batches.map((batch, idx) => {
      return this._sendMessageBatch(batch, delay, attributes, idx * AWS_MAX_SEND_BATCH)
    })).then((results) => {
      const merged = {Successful: [], Failed: []}
      results.forEach((res) => {
        res.Successful.forEach(elem => merged.Successful.push(elem))
        res.Failed.forEach(elem => merged.Failed.push(elem))
      })
      return merged
    })
  }

  /**
   * Starts the poller, if it's not already running.
   */
  start() {
    if (!this._running) {
      this._running = true
      this._startPoller()
    }
  }

  /**
   * Stops the poller.
   * @param {boolean} [soft=false] If a soft stop is performed, any active SQS request for new messages will be left
   *    open until it terminates naturally. Note that if this is the case, the message event may still be fired after
   *    this function has been called.
   */
  stop(soft) {
    if (!soft && this._activeReq) {
      this._activeReq.abort()
    }
    this._running = false
    this._paused = false
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
    this.getQueueUrl().then((queueUrl) => {
      return this.sqs.deleteMessageBatch({
        QueueUrl: queueUrl,
        Entries: batch
      }).promise()
    }).then((data) => {
      if (data.Failed && data.Failed.length) {
        data.Failed.forEach((fail) => this.emit('delError', fail))
      }
    }).catch((err) => {
      this.emit('error', err)
    })
  }

  /**
   * Given an array of message bodies from SQS, this method will construct Message objects for each and emit them
   * in separate `message` events.
   * @param {Array<Object>} messages An array of SQS message objects, as returned from the aws sdk
   * @private
   */
  _emitMessages(messages) {
    messages.forEach((msg) => {
      const message = new Message({
        squiss: this,
        unwrapSns: this._opts.unwrapSns,
        bodyFormat: this._opts.bodyFormat,
        msg
      })
      this._inFlight++
      this.emit('message', message)
    })
  }

  /**
   * Gets a new batch of messages from Amazon SQS. Note that this function does no checking of the current inFlight
   * count, or the current running status. A `message` event will be emitted for each new message, with the provided
   * object being an instance of Squiss' Message class.
   * @private
   */
  _getBatch(queueUrl) {
    const next = this._getBatch.bind(this, queueUrl)
    const params = {
      QueueUrl: queueUrl,
      MaxNumberOfMessages: this._opts.receiveBatchSize,
      WaitTimeSeconds: this._opts.receiveWaitTimeSecs
    }
    if (this._opts.visibilityTimeoutSecs !== undefined) {
      params.VisibilityTimeout = this._opts.visibilityTimeoutSecs
    }
    this._activeReq = this.sqs.receiveMessage(params)
    this._activeReq.promise().then((data) => {
      let gotMessages = true
      this._activeReq = null
      if (data && data.Messages) {
        this.emit('gotMessages', data.Messages.length)
        this._emitMessages(data.Messages)
      } else {
        this.emit('queueEmpty')
        gotMessages = false
      }
      if (this._slotsAvailable()) {
        if (gotMessages && this._opts.activePollIntervalMs) {
          setTimeout(next, this._opts.activePollIntervalMs)
        } else if (!gotMessages && this._opts.idlePollIntervalMs) {
          setTimeout(next, this._opts.idlePollIntervalMs)
        } else {
          next()
        }
      } else {
        this._paused = true
        this.emit('maxInFlight')
      }
    }).catch((err) => {
      this._activeReq = null
      if (err.code && err.code === 'RequestAbortedError') {
        this.emit('aborted')
      } else {
        setTimeout(next, this._opts.pollRetryMs)
        this.emit('error', err)
      }
    })
  }

  /**
   * Sends a batch of a maximum of 10 messages to Amazon SQS. The Id generated for each will be the stringified
   * index of each message in the array, plus the startIndex
   * @param {Array<string|Object>} messages An array of messages to be sent. Objects will be JSON.stringified.
   * @param {number} [delay] The number of seconds by which to delay the delivery of the messages, max 900. If not
   *    specified, the queue default will be used.
   * @param {Object} [attributes] An optional attributes mapping to associate with all messages. For more information,
   *    see http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SQS.html#sendMessageBatch-property.
   * @param {number} [startIndex=0] The index at which to start numbering the messages.
   * @returns {Promise.<{Successful: Array<{Id: string, MessageId: string, MD5OfMessageAttributes: string,
   *    MD5OfMessageBody: string}>, Failed: Array<{Id: string, SenderFault: boolean, Code: string,
   *    Message: string}>}>} Resolves with successful and failed messages, rejects with API error on critical failure.
   * @private
   */
  _sendMessageBatch(messages, delay, attributes, startIndex) {
    const start = startIndex || 0
    return this.getQueueUrl().then((queueUrl) => {
      const params = {
        QueueUrl: queueUrl,
        Entries: []
      }
      messages.forEach((msg, idx) => {
        const entry = {
          Id: (start + idx).toString(),
          MessageBody: typeof msg === 'object' ? JSON.stringify(msg) : msg
        }
        if (delay) entry.DelaySeconds = delay
        if (attributes) entry.MessageAttributes = attributes
        params.Entries.push(entry)
      })
      return this.sqs.sendMessageBatch(params).promise()
    })
  }

  /**
   * Determines if there are enough available slots to receive another batch of messages from Amazon SQS without going
   * over the maxInFlight limit set in the constructor options.
   * @returns {boolean}
   * @private
   */
  _slotsAvailable() {
    return !this._opts.maxInFlight || this._inFlight <= this._opts.maxInFlight - this._opts.receiveBatchSize
  }

  /**
   * Starts the polling process, regardless of the status of the this._running or this._paused flags.
   * @private
   */
  _startPoller() {
    this.getQueueUrl()
      .then(queueUrl => this._getBatch(queueUrl))
      .catch(e => this.emit('error', e))
  }
}

module.exports = Squiss
