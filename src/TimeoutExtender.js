/*
 * Copyright (c) 2015-2017 TechnologyAdvice
 */

'use strict'

/**
 * The maximum age, in milliseconds, that a message can reach before AWS will no longer accept VisibilityTimeout
 * extensions.
 * @type {number}
 */
const MAX_MESSAGE_AGE_MS = 43200000

/**
 * Option defaults.
 * @type {Object}
 */
const optDefaults = {
  visibilityTimeoutSecs: 30,
  noExtensionsAfterSecs: MAX_MESSAGE_AGE_MS / 1000,
  advancedCallMs: 5000
}

/**
 * The TimeoutExtender is a module that attaches itself to a Squiss instance via event
 * listeners, and uses the instance's public API to automatically extend the
 * VisibilityTimeout of the message until it is either handled (which includes actions
 * such as deleting or releasing the message) or it reaches an age that is greater than
 * the `noExtensionsAfterSecs` option. Functionally, this class could be distributed as a
 * third party module and attached to a Squiss instance by the user, however the common
 * and convenient use case is for this class to be used internally by Squiss itself.
 *
 * For efficient operation, the TimeoutExtender combines a doubly-linked list with a
 * hash map, keeping an index of every message while not incurring the RAM or CPU overhead
 * of having to re-create an array every time a message is deleted from the middle of a
 * sorted queue. Every operation in this class has a time complexity of O(1) and a space
 * complexity of O(n).
 */
class TimeoutExtender {

  /**
   * Creates a new TimeoutExtender.
   * @param {Squiss} squiss The Squiss instance on which this extender should operate
   * @param {Object} opts An object containing options mappings
   * @param {number} [opts.visibilityTimeoutSecs=30] The queue's VisibilityTimeout, in
   * seconds. This will be used to know when to extend a message. It will also be the
   * amount of time by which the timeout gets extended.
   * @param {number} [opts.noExtensionsAfterSecs=43200] The number of seconds after which
   * a message's VisibilityTimeout should not be extended. The default and maximum value
   * (imposed by AWS) is 43200 (12 hours).
   * @param {number} [opts.advancedCallMs=5000] The amount of time before a message's
   * VisibilityTimeout expiration to make the API call to extend it. Setting this too
   * high will cause a message to be extended within a time frame where it may be deleted
   * anyway; setting too low may cause the message to expire before the API call can
   * complete. The max is `opts.visibilityTimeoutSecs * 1000`.
   */
  constructor(squiss, opts) {
    this._opts = Object.assign({}, optDefaults, opts)
    this._head = null
    this._tail = null
    this._index = {}
    this._timer = null
    this._squiss = squiss
    this._squiss.on('handled', msg => this.deleteMessage(msg))
    this._squiss.on('message', msg => this.addMessage(msg))
    this._visTimeout = this._opts.visibilityTimeoutSecs * 1000
    this._stopAfter = Math.min(this._opts.noExtensionsAfterSecs * 1000, MAX_MESSAGE_AGE_MS)
    this._apiLeadMs = Math.min(this._opts.advancedCallMs, this._visTimeout)
  }

  /**
   * Adds a new message to the tracker.
   * @param {Message} message A Squiss Message object
   */
  addMessage(message) {
    const now = Date.now()
    this._addNode({
      message,
      receivedOn: now,
      timerOn: now + this._visTimeout - this._apiLeadMs
    })
  }

  /**
   * Deletes a message from the tracker, if the message is currently being tracked.
   * @param {Message} message A Squiss Message object
   */
  deleteMessage(message) {
    const node = this._index[message.raw.MessageId]
    if (node) this._deleteNode(node)
  }

  /**
   * Adds a message wrapper node to the linked list and hash map index.
   * @param {{message: Message, receivedOn: number, timerOn: number}} node The node
   * object to be added
   * @private
   */
  _addNode(node) {
    this._index[node.message.raw.MessageId] = node
    if (!this._head) {
      this._head = node
      this._tail = node
      this._headChanged()
    } else {
      this._tail.next = node
      node.prev = this._tail
      this._tail = node
    }
  }

  /**
   * Deletes a message wrapper node from the linked list and hash map index.
   * @param {{message: Message, receivedOn: number, timerOn: number}} node The node
   * object to be removed
   * @private
   */
  _deleteNode(node) {
    const msgId = node.message.raw.MessageId
    delete this._index[msgId]
    if (this._head === node) {
      this._head = node.next
      if (this._head) delete this._head.prev
      this._headChanged()
    } else if (this._tail === node) {
      this._tail = this._tail.prev
      delete this._tail.next
    } else {
      node.prev.next = node.next
      node.next.prev = node.prev
    }
  }

  /**
   * Gets the current millisecond age of a tracked message, projected `opts.advancedCallMs`
   * into the future.
   * @param node The node to be checked
   * @returns {number} The age of the message in milliseconds
   * @private
   */
  _getNodeAge(node) {
    return Date.now() - node.receivedOn + this._apiLeadMs
  }

  /**
   * Called internally when the head of the linked list has changed in any way. This
   * function is responsible for maintaining the timer that determines the tracker's next
   * action.
   * @returns {boolean} true if a timer was set in response to the changed head; false
   * otherwise.
   * @private
   */
  _headChanged() {
    if (this._timer) clearTimeout(this._timer)
    if (!this._head) return false
    const node = this._head
    this._timer = setTimeout(() => {
      if (this._getNodeAge(node) >= this._stopAfter) return this._deleteNode(node)
      return this._renewNode(node)
    }, node.timerOn - Date.now())
    return true
  }

  /**
   * Extends the VisibilityTimeout of the message contained in the provided wrapper node,
   * and moves the node to the tail of the linked list.
   * @param {{message: Message, receivedOn: number, timerOn: number}} node The node
   * object to be renewed
   * @private
   */
  _renewNode(node) {
    const extendByMs = Math.min(this._visTimeout, MAX_MESSAGE_AGE_MS - this._getNodeAge(node))
    const extendBySecs = Math.floor(extendByMs / 1000)
    this._squiss.changeMessageVisibility(node.message, extendBySecs)
      .then(() => this._squiss.emit('timeoutExtended', node.message))
      .catch(err => {
        if (err.message.match(/Message does not exist or is not available/)) {
          this._deleteNode(node)
          this._squiss.emit('autoExtendFail', { message: node.message, error: err })
        } else {
          this._squiss.emit('error', err)
        }
      })
    this._deleteNode(node)
    node.timerOn = Date.now() + extendBySecs * 1000
    this._addNode(node)
  }
}

module.exports = TimeoutExtender

