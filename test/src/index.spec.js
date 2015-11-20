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
  });
});
