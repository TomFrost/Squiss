/*
 * Copyright (c) 2015 TechnologyAdvice
 */

import Squiss from 'src/index';

describe('index', () => {
  describe('constructor', () => {
    it('creates a new Squiss instance', () => {
      const inst = new Squiss({ queue: 'foo' });
      should.exist(inst);
    });
    it('should fail if queue is not specified', () => {
      let errored = false;
      try {
        new Squiss();
      } catch(e) {
        should.exist(e);
        e.should.be.instanceOf(Error);
        errored = true;
      }
      errored.should.be.true;
    });
    it('provides a configured sqs client instance', () => {
      const inst = new Squiss({
        queue: 'foo',
        awsConfig: {
          region: 'us-east-1'
        }
      });
      inst.should.have.property('sqs');
      inst.sqs.should.be.an.Object;
      inst.sqs.config.region.should.equal('us-east-1');
    });
  });
});
