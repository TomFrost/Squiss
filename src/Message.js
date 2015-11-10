/*
 * Copyright (c) 2015 TechnologyAdvice
 */

export class Message {
  constructor(opts) {
    this.raw = opts.msg;
    this.body = opts.msg.Body;
    if (opts.unwrapSns) {
      this.body = Message._snsUnwrap(this.msg);
    }
    this.body = Message._formatMessage(opts.msg, opts.msgFormat);
    this._squiss = opts.squiss;
    this._handled = false;
  }

  del() {
    if (!this._handled) {
      this._squiss.deleteMessage(this);
      this._handled = true;
    }
  }

  keep() {
    if (!this._handled) {
      this._squiss.handledMessage();
      this._handled = true;
    }
  }
}

Message._formatMessage = (msg, format) => {
  switch (format) {
  case 'json': return JSON.parse(msg);
  default: return msg;
  }
};

Message._snsUnwrap = (msg) => {
  return JSON.parse(msg).Message;
};
