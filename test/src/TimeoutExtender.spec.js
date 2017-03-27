/*
 * Copyright (c) 2015-2017 TechnologyAdvice
 */

'use strict'

const TimeoutExtender = require('src/TimeoutExtender')
const SquissStub = require('test/stubs/SquissStub')
const Message = require('src/Message')
const delay = require('delay')

let inst = null
const fooMsg = new Message({ msg: { MessageId: 'foo', Body: 'foo' } })
const barMsg = new Message({ msg: { MessageId: 'bar', Body: 'bar' } })
const bazMsg = new Message({ msg: { MessageId: 'baz', Body: 'baz' } })

describe('TimeoutExtender', () => {
  afterEach(() => {
    inst = null
  })
  it('adds and deletes a message through function calls', () => {
    inst = new TimeoutExtender(new SquissStub())
    inst.addMessage(fooMsg)
    inst._index.should.have.property('foo')
    inst.deleteMessage(fooMsg)
    inst._index.should.not.have.property('foo')
  })
  it('adds and deletes a message through events', () => {
    const squiss = new SquissStub()
    inst = new TimeoutExtender(squiss)
    const addSpy = sinon.spy(inst, 'addMessage')
    const delSpy = sinon.spy(inst, 'deleteMessage')
    squiss.emit('message', fooMsg)
    return delay(5).then(() => {
      addSpy.should.be.calledOnce()
      squiss.emit('handled', fooMsg)
      return delay(5)
    }).then(() => {
      delSpy.should.be.calledOnce()
    })
  })
  it('fails silently when asked to delete a nonexistent message', () => {
    inst = new TimeoutExtender(new SquissStub())
    inst.addMessage(fooMsg)
    inst.deleteMessage(barMsg)
  })
  it('tracks multiple messages', () => {
    inst = new TimeoutExtender(new SquissStub())
    inst.addMessage(fooMsg)
    inst.addMessage(barMsg)
    inst._index.should.have.property('foo')
    inst._index.should.have.property('bar')
  })
  it('deletes a head node', () => {
    inst = new TimeoutExtender(new SquissStub())
    inst.addMessage(fooMsg)
    inst.addMessage(barMsg)
    inst.addMessage(bazMsg)
    inst.deleteMessage(fooMsg)
    inst._head.message.raw.MessageId.should.equal('bar')
  })
  it('deletes a tail node', () => {
    inst = new TimeoutExtender(new SquissStub())
    inst.addMessage(fooMsg)
    inst.addMessage(barMsg)
    inst.addMessage(bazMsg)
    inst.deleteMessage(bazMsg)
    inst._tail.message.raw.MessageId.should.equal('bar')
  })
  it('deletes a middle node', () => {
    inst = new TimeoutExtender(new SquissStub())
    inst.addMessage(fooMsg)
    inst.addMessage(barMsg)
    inst.addMessage(bazMsg)
    inst.deleteMessage(barMsg)
    inst._head.next.message.raw.MessageId.should.equal('baz')
  })
})
