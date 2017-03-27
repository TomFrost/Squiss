/*
 * Copyright (c) 2015-2017 TechnologyAdvice
 */

'use strict'

const EventEmitter = require('events').EventEmitter

class SquissStub extends EventEmitter {
  changeMessageVisibility() {
    return Promise.resolve()
  }
}

module.exports = SquissStub
