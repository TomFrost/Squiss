/*
 * Copyright (c) 2015-2016 TechnologyAdvice
 */

'use strict'

const chai = require('chai')
const path = require('path')
const mod = require('module')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')

chai.use(sinonChai)

global.should = chai.should()
global.sinon = sinon

// importing files with ../../../../../.. makes my brain hurt
process.env.NODE_PATH = path.join(__dirname, '..') + path.delimiter + (process.env.NODE_PATH || '')
mod._initPaths()
