/*
 * Copyright (c) 2015 TechnologyAdvice
 */

import Squiss from 'src/index';
import SQSStub from 'test/stubs/SQSStub';

let inst = null;

describe('index', () => {
  afterEach(() => {
    if (inst) inst.stop();
    inst = null;
  });
  describe('constructor', () => {
    it('creates a new Squiss instance', () => {
      inst = new Squiss({ queueUrl: 'foo' });
      should.exist(inst);
    });
    it('fails if queue is not specified', () => {
      let errored = false;
      try {
        new Squiss();
      } catch (e) {
        should.exist(e);
        e.should.be.instanceOf(Error);
        errored = true;
      }
      errored.should.be.true;
    });
    it('provides a configured sqs client instance', () => {
      inst = new Squiss({
        queueUrl: 'foo',
        awsConfig: {
          region: 'us-east-1'
        }
      });
      inst.should.have.property('sqs');
      inst.sqs.should.be.an.Object;
      inst.sqs.config.region.should.equal('us-east-1');
    });
  });
  describe('API', () => {
    it('reports the appropriate "running" status', () => {
      inst = new Squiss({ queueUrl: 'foo' });
      inst._getBatch = () => {};
      inst.running.should.be.false;
      inst.start();
      inst.running.should.be.true;
    });
    it('receives a batch of messages under the max', (done) => {
      let msgs = 0;
      inst = new Squiss({ queueUrl: 'foo' });
      inst.sqs = new SQSStub(5);
      inst.start();
      inst.on('message', () => msgs++);
      setImmediate(() => {
        msgs.should.equal(5);
        done();
      });
    });
    it('receives batches of messages', (done) => {
      let msgs = 0;
      inst = new Squiss({ queueUrl: 'foo' });
      inst.sqs = new SQSStub(15);
      inst.start();
      inst.on('message', () => msgs++);
      setImmediate(() => {
        msgs.should.equal(10);
        setImmediate(() => {
          msgs.should.equal(15);
          done();
        });
      });
    });
    it('observes the maxInFlight cap', (done) => {
      let msgs = 0;
      inst = new Squiss({ queueUrl: 'foo', maxInFlight: 10 });
      inst.sqs = new SQSStub(15);
      inst.start();
      inst.on('message', () => msgs++);
      setImmediate(() => {
        msgs.should.equal(10);
        setImmediate(() => {
          msgs.should.equal(10);
          done();
        });
      });
    });
    it('deletes messages', (done) => {
      let msgs = [];
      inst = new Squiss({ queueUrl: 'foo', deleteWaitMs: 0 });
      inst.sqs = new SQSStub(5);
      sinon.spy(inst.sqs, 'deleteMessageBatch');
      inst.start();
      inst.on('message', (msg) => msgs.push(msg));
      setImmediate(() => {
        msgs.should.have.length(5);
        inst.deleteMessage(msgs.pop());
        setTimeout(() => {
          inst.sqs.deleteMessageBatch.should.be.called;
          done();
        }, 10);
      });
    });
    it('reports the correct number of inFlight messages', (done) => {
      let msgs = [];
      inst = new Squiss({ queueUrl: 'foo', deleteWaitMs: 0 });
      inst.sqs = new SQSStub(5);
      inst.start();
      inst.on('message', (msg) => msgs.push(msg));
      setImmediate(() => {
        inst.inFlight.should.equal(5);
        inst.deleteMessage(msgs.pop());
        inst.handledMessage();
        setImmediate(() => {
          inst.inFlight.should.equal(3);
          done();
        });
      });
    });
  });
});
