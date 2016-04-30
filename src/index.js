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
  correctQueueUrl: false,
  pollRetryMs: 2000,
  activePollIntervalMs: 0,
  idlePollIntervalMs: 0
}

/**
 * Squiss is a high-volume-capable Amazon SQS polling class. See README for usage details.
 */
class Squiss extends EventEmitter {

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
   * @param {number} [opts.pollRetryMs=2000] The number of milliseconds to wait before retrying when Squiss's call to
   *    retrieve messages from SQS fails.
   * @param {number} [opts.activePollIntervalMs=0] The number of milliseconds to wait between requesting batches of
   *    messages when the queue is not empty, and the maxInFlight cap has not been hit.
   * @param {number} [opts.idlePollIntervalMs
   */
  constructor(opts) {
    super()
    this.sqs = new AWS.SQS(opts.awsConfig)
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
   * Creates the configured queue in Amazon SQS and retrieves its queue URL. Note that this method can only be called
   * if Squiss was instantiated with the queueName property.
   * @param {{DelaySeconds: number, MaximumMessageSize: number, MessageRetentionPeriod: number, Policy: Object,
   *    ReceiveMessageWaitTimeSeconds: number, VisibilityTimeout: number}} [attributes] An optional attribute mapping
   *    to send to SQS. Attributes and their defaults can be found at
   *    http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SQS.html#createQueue-property. Squiss will set
   *    ReceiveMessageWaitTimeSeconds to the configured receiveWaitTimeSeconds if not otherwise specified.
   * @returns {Promise.<string>} Resolves with the URL of the created queue, rejects with the official AWS SDK's
   *    error object.
   */
  createQueue(attributes) {
    if (!this._opts.queueName) {
      return Promise.reject(new Error('Squiss was not instantiated with a queueName'))
    }
    const params = {
      QueueName: this._opts.queueName,
      Attributes: {
        ReceiveMessageWaitTimeSeconds: this._opts.receiveWaitTimeSecs.toString()
      }
    }
    Object.assign(params.Attributes, attributes || {})
    return this.sqs.createQueue(params).promise().then(res => {
      this._queueUrl = res.QueueUrl
      return res.QueueUrl
    })
  }

  /**
   * Queues the given message for deletion. The message will actually be deleted from SQS per the settings
   * supplied to the constructor.
   * @param {Message} msg The message to be deleted.
   */
  deleteMessage(msg) {
    this._delQueue.push({ Id: msg.raw.MessageId, ReceiptHandle: msg.raw.ReceiptHandle })
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
      params.QueueOwnerAWSAccountId = this._opts.accountNumber
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
        if (res.Successful) {
          res.Successful.forEach(elem => merged.Successful.push(elem))
        }
        if (res.Failed) {
          res.Failed.forEach(elem => merged.Failed.push(elem))
        }
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
   * @returns {boolean} true if a request was triggered; false otherwise.
   * @private
   */
  _getBatch(queueUrl) {
    if (this._activeReq || !this._running) return false
    const next = this._getBatch.bind(this, queueUrl)
    const params = {
      QueueUrl: queueUrl,
      MaxNumberOfMessages: this._opts.receiveBatchSize,
      WaitTimeSeconds: this._opts.receiveWaitTimeSecs
    }
    if (this._opts.visibilityTimeout !== undefined) {
      params.VisibilityTimeout = this._opts.visibilityTimeout
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
    return true
  }

  _sendMessageBatch(messages, delay, attributes, startIndex) {
    if (!Array.isArray(messages) || messages.length > AWS_MAX_SEND_BATCH) {
      return Promise.reject(`messages must be an array of ${AWS_MAX_SEND_BATCH} messages at most.`)
    }
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

  _startPoller() {
    this.getQueueUrl()
      .then(queueUrl => this._getBatch(queueUrl))
      .catch(e => this.emit('error', e))
  }
}

module.exports = Squiss
