/*
 * Copyright (c) 2015 TechnologyAdvice
 */

import chai from 'chai';
import path from 'path';
import module from 'module';
import sinon from 'sinon';

global.should = chai.should();
global.sinon = sinon;

// importing files with ../../../../../.. makes my brain hurt
process.env.NODE_PATH = path.join(__dirname, '..') + path.delimiter + (process.env.NODE_PATH || '');
module._initPaths();
