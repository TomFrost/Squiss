/*
 * Copyright (c) 2015-2017 TechnologyAdvice
 */

'use strict'

const TimeoutExtender = require('src/TimeoutExtender')
const SquissStub = require('test/stubs/SquissStub')
const Message = require('src/Message')
const delay = require('delay')

let inst = null
let clock = null
const fooMsg = new Message({ msg: { MessageId: 'foo', Body: 'foo' } })
const barMsg = new Message({ msg: { MessageId: 'bar', Body: 'bar' } })
const bazMsg = new Message({ msg: { MessageId: 'baz', Body: 'baz' } })
const notExistError = new Error('Value AQEB5iHoiWO4nU0Tx3mGzJLdXNQ+fg3nadtYYTDoWMhuOiUOP7sjZTgC64MlRbSwFneA5+' +
  'C+fS5DGRbiEC1VAF0KTMEBrgEOVAQpwRQo8yfie8ltzf+0LLasaHrTB1IFDIvQ0+wsrM4PxXiDJD1tzQ2kw89ijfP4W4tAy6Dqvd5mhlAn' +
  'V+Gvq5IhSRrlzUx9ZOSZyoYPfWN7KwJVKrCWYIyGN3nkGaKwTc+HlJ3jABjTEWHULD9lZjWfBXMWY9bvIVvYuyg2BkSjqb/WKdM6eSPjIA' +
  'UxPIeI6HlkCccfAr9i2GeRmUJp+29g6l0kw3WKJ8msybx1kRzZ11E9++pbhay62SAZKeHZ/E+KuV1jwCJ9nFYPPPk/SwsgUSO1Q4ULYc/0' +
  ' for parameter ReceiptHandle is invalid. Reason: Message does not exist or is not available for visibility ' +
  'timeout change.')

describe('TimeoutExtender', () => {
  afterEach(() => {
    if (clock && clock.restore) clock.restore()
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
  it('renews a message approaching expiry', () => {
    clock = sinon.useFakeTimers(100000)
    const squiss = new SquissStub()
    const spy = sinon.spy(squiss, 'changeMessageVisibility')
    inst = new TimeoutExtender(squiss, { visibilityTimeoutSecs: 10 })
    inst.addMessage(fooMsg)
    spy.should.not.be.called()
    clock.tick(6000)
    spy.should.be.calledOnce()
  })
  it('emits "timeoutExtended" on renewal', done => {
    clock = sinon.useFakeTimers(100000)
    const squiss = new SquissStub()
    squiss.on('timeoutExtended', msg => {
      msg.should.equal(fooMsg)
      done()
    })
    inst = new TimeoutExtender(squiss, { visibilityTimeoutSecs: 10 })
    inst.addMessage(fooMsg)
    clock.tick(6000)
  })
  it('renews two messages approaching expiry', () => {
    clock = sinon.useFakeTimers(100000)
    const squiss = new SquissStub()
    const spy = sinon.spy(squiss, 'changeMessageVisibility')
    inst = new TimeoutExtender(squiss, { visibilityTimeoutSecs: 20 })
    inst.addMessage(fooMsg)
    clock.tick(10000)
    inst.addMessage(barMsg)
    spy.should.not.be.called()
    clock.tick(10000)
    spy.should.be.calledOnce()
    clock.tick(10000)
    spy.should.be.calledTwice()
    clock.tick(10000)
    spy.should.be.calledThrice()
  })
  it('renews only until the configured age limit', () => {
    clock = sinon.useFakeTimers(100000)
    const squiss = new SquissStub()
    const spy = sinon.spy(squiss, 'changeMessageVisibility')
    inst = new TimeoutExtender(squiss, { visibilityTimeoutSecs: 10, noExtensionsAfterSecs: 15 })
    inst.addMessage(fooMsg)
    clock.tick(10000)
    spy.should.be.calledOnce()
    clock.tick(20000)
    spy.should.be.calledOnce()
  })
  it('emits error on the parent Squiss object in case of issue', done => {
    clock = sinon.useFakeTimers(100000)
    const squiss = new SquissStub()
    squiss.on('error', () => done())
    squiss.changeMessageVisibility = sinon.stub().returns(Promise.reject(new Error('test')))
    inst = new TimeoutExtender(squiss, { visibilityTimeoutSecs: 10 })
    inst.addMessage(fooMsg)
    clock.tick(6000)
  })
  it('calls changeMessageVisibility with the appropriate timeout value', () => {
    clock = sinon.useFakeTimers(100000)
    const squiss = new SquissStub()
    const spy = sinon.spy(squiss, 'changeMessageVisibility')
    inst = new TimeoutExtender(squiss, { visibilityTimeoutSecs: 10 })
    inst.addMessage(fooMsg)
    clock.tick(6000)
    spy.should.be.calledWith(fooMsg, 10)
  })
  it('emits autoExtendFail when an extended message has already been deleted', done => {
    clock = sinon.useFakeTimers(100000)
    const squiss = new SquissStub()
    squiss.on('autoExtendFail', obj => {
      try {
        obj.should.deep.equal({
          message: fooMsg,
          error: notExistError
        })
      } catch (e) {
        return done(e)
      }
      return done()
    })
    squiss.changeMessageVisibility = sinon.stub().returns(Promise.reject(notExistError))
    inst = new TimeoutExtender(squiss, { visibilityTimeoutSecs: 10 })
    inst.addMessage(fooMsg)
    clock.tick(6000)
  })
})
