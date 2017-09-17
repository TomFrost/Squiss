/*
 * Copyright (c) 2017 Tom Shawver
 */

'use strict'

const EventEmitter = require('events').EventEmitter

class SquissStub extends EventEmitter {
  changeMessageVisibility() {
    return Promise.resolve()
  }
}

module.exports = SquissStub
