/*
 * Copyright (c) 2017 Tom Shawver
 */

'use strict'

/**
 * The message class is a wrapper for Amazon SQS messages that provides the raw and parsed message body,
 * optionally removed SNS wrappers, and provides convenience functions to delete or keep a given message.
 */
class Message {

  /**
   * Creates a new Message.
   * @param {Object} opts A mapping of message-creation options
   * @param {Object} opts.msg A parsed SQS response as returned from the official aws-sdk
   * @param {boolean} [opts.unwrapSns=false] Set to `true` to denote that each message should be treated as though
   *    it comes from a queue subscribed to an SNS endpoint, and automatically extract the message from the SNS
   *    metadata wrapper.
   * @param {string} opts.bodyFormat "plain" to not parse the message body, or "json" to pass it through JSON.parse
   *    on creation
   * @param {Squiss} opts.squiss The squiss instance responsible for retrieving this message. This will be used to
   *    delete the message and update inFlight count tracking.
   */
  constructor(opts) {
    this.raw = opts.msg
    this.body = opts.msg.Body
    if (opts.unwrapSns) {
      let unwrapped = JSON.parse(this.body)
      this.body = unwrapped.Message
      this.subject = unwrapped.Subject
      this.topicArn = unwrapped.TopicArn
      this.topicName = unwrapped.TopicArn.substr(unwrapped.TopicArn.lastIndexOf(':') + 1)
    }
    this.body = Message._formatMessage(this.body, opts.bodyFormat)
    this._squiss = opts.squiss
    this._handled = false
  }

  /**
   * Queues this message for deletion.
   */
  del() {
    if (!this._handled) {
      this._squiss.deleteMessage(this)
      this._handled = true
    }
  }

  /**
   * Keeps this message, but releases its inFlight slot in Squiss.
   */
  keep() {
    if (!this._handled) {
      this._squiss.handledMessage(this)
      this._handled = true
    }
  }

  /**
   * Changes the visibility timeout of the message to 0.
   */
  release() {
    if (!this._handled) {
      this._squiss.releaseMessage(this)
      this._handled = true
    }
  }

  /**
   * Changes the visibility timeout of the message.
   */
  changeVisibility(timeoutInSeconds) {
    return this._squiss.changeMessageVisibility(this, timeoutInSeconds)
  }
}

/**
 * Parses a message according to the given format.
 * @param {string} msg The message to be parsed
 * @param {string} format The format of the message. Currently supports "json".
 * @returns {Object|string} The parsed message, or the original message string if the format type is unknown.
 * @private
 */
Message._formatMessage = (msg, format) => {
  switch (format) {
  case 'json': return JSON.parse(msg)
  default: return msg
  }
}

module.exports = Message
