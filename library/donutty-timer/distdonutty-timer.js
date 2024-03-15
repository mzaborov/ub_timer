/**
 * donutty timer // Create beautiful countdown timers and clocks with Javascript
 * @author i1group <i@i1group.ru>
 * @version 1.2.0
 * @license MIT
 * @link https://i1group.ru
 * @preserve
 */

(function(doc, win) {
  'use strict';

  var donuttyTimer;

  function isDefined(input) {
    return typeof input !== 'undefined';
  }

  function intval(input) {
    var res = parseInt(input, 10);
    return res ? res : 0;
  }

  function truth(input) {
    return isDefined(input) && (input === true || input === 'true' || input === 1 || input === '1');
  }

  /**
   * Constructor for DonuttyTimer.
   *
   * @param string|object el
   *   Css selector or DOM object of a timer container.
   * @param object options
   *   Timer options.
   *
   * @chainable
   */
  donuttyTimer = win.DonuttyTimer = function(el, options) {
    // Get container
    if (el && typeof el === 'string') {
      this.$wrapper = doc.querySelector(el);
    } else if (el instanceof window.HTMLElement) {
      this.$wrapper = el;
    } else {
      this.$wrapper = doc.body;
      options = el;
    }

    if (!this.$wrapper || !win.Donutty) {
      return this;
    }

    // Get options from tag 'data-' attributes if not set
    if (options === null) {
      options = this.getOptionsFromTag();
    }

    // Set default option values
    this.options = options || {};
    this.options.autostart = isDefined(options.autostart) ? intval(options.autostart) : 0;
    this.options.valueonstop = isDefined(options.valueonstop) ? options.valueonstop : 'reset';
    this.options.speed = isDefined(options.speed) ? intval(options.speed) : 1000;
    this.options.delta = isDefined(options.delta) ? intval(options.delta) : -1;
    this.options.min = isDefined(options.min) ? intval(options.min) : 0;
    this.options.max = isDefined(options.max) ? intval(options.max) : 60;
    this.options.runout = isDefined(options.runout) ? intval(options.runout) : 0;
    this.options.value = isDefined(options.value) ? intval(options.value) : this.options.delta > 0 ? this.options.min : this.options.max;
    this.options.valuedisplay = this.options.value;
    this.options.valueinitial = this.options.value;
    this.options.transition = isDefined(options.transition) ? options.transition : 'all 200ms linear';
    this.options.transitionsync = isDefined(options.transitionsync) ? truth(options.transitionsync) : true;
    this.options.callbacksafterstop = isDefined(options.callbacksafterstop) ? truth(options.callbacksafterstop) : false;
    this.options.format = isDefined(options.format) ? options.format : {min: true, sec: true};
    this.options.separator = isDefined(options.separator) ? options.separator : ':';
    this.options.tag = isDefined(options.tag) ? options.tag : 'span';
    this.options.labels = isDefined(options.labels) ? options.labels : {};
    this.options.buttons = isDefined(options.buttons) ? options.buttons : {};
    this.options.callbacks = isDefined(options.callbacks) ? options.callbacks : {};
    this.options.stoponend = isDefined(options.stoponend) ? truth(options.stoponend) : true;
    this.options.resetvalueonstart = isDefined(options.resetvalueonstart) ? truth(options.resetvalueonstart) : true;
    this.options.responsive = isDefined(options.responsive) ? truth(options.responsive) : true;

    this.init();

    return this;
  };

  /**
   * Get options from 'data-' attributes of a container tag.
   *
   * @return object
   *   Timer options.
   */
  donuttyTimer.prototype.getOptionsFromTag = function() {
    var res = JSON.parse(JSON.stringify(this.$wrapper.dataset)),
    parse = ['format', 'labels', 'buttons'];

    // Some options are required to be converted from string to object
    for (var i in parse) {
      if (res[parse[i]]) {
        res[parse[i]] = JSON.parse(res[parse[i]].replace(/\'/g, '"'));
      }
    }

    return res;
  }

  /**
   * Returns transition duration.
   *
   * Parses transition option like 'all 200ms linear' or 'all 1s' to get
   * duration from it.
   *
   * @return int
   *   Transition duration in ms.
   *   If options.transitionsync is false will always return 0.
   */
  donuttyTimer.prototype.getTransitionDuration = function() {
    var k = 0,
    duration = 0,
    transition = this.options.transition.split(' ');
    
    if (!this.options.transitionsync || !transition[0] || transition[0] == 'none') {
      return 0;
    }
    
    for (var i = 0; !k && i < transition.length; i++) {
      var time = parseFloat(transition[i]);
      
      // If duration found
      if (time > 0) {
        k = transition[i].indexOf('ms') > 0 ? 1 : 1000;
        duration = k * time;
      }
      // Also check for 0 duration
      else {
        transition[i] = transition[i].trim();
        if (transition[i] == '0s' || transition[i] == '0ms') {
          k = 1;
        }
      }
    }

    return duration;
  }
  
  /**
   * Initialize Timer.
   *
   * Normally you shouldn't call this function, it will be called automatically.
   *
   * @chainable
   */
  donuttyTimer.prototype.init = function() {
    this.$wrapper.innerHTML = '';
    this.$wrapper.donutty = new Donutty(this.$wrapper, this.options);
    this.$wrapper.donuttyTimer = this;
    // Used to record events fired
    this.was = {};

    this.createText();
    this.assignButtons();
    this.reset('');
    this.initStyles();
    !this.options.responsive && this.updateSize();
    this.setStatus('init');
    this.callback('init');

    // Start the timer if autostart is set
    if (this.options.autostart >= 0) {
      var _this = this;
      this.interval = setTimeout(function(){_this.start();}, this.options.autostart);
    }

    return this;
  };

  /**
   * Add clock face digits (text) container.
   *
   * Normally you shouldn't call this function, it will be called automatically.
   *
   * @chainable
   */
  donuttyTimer.prototype.createText = function() {
    var donutty = this.$wrapper.donutty;
    
    if (donutty && !donutty.$text) {
      donutty.$text = doc.createElement('span');
      donutty.$text.classList.add('donut-text');
      donutty.$text.style.opacity = 0;
      donutty.$wrapper.appendChild(donutty.$text);
      this.updateText();
      setTimeout(function(){donutty.$text.style.opacity = 1;}, this.getTransitionDuration());
    }

    return this;
  };

  /**
   * Assign onclick events for buttons (from options.buttons property).
   *
   * Normally you shouldn't call this function, it will be called automatically.
   *
   * @chainable
   */
  donuttyTimer.prototype.assignButtons = function() {
    var buttons = this.options.buttons,
    btns = ['play', 'pause', 'stop', 'playpause'];

    // Assign functions on click for buttons (if set)
    this.options.domButtons = {};
    for (var i in btns) {
      this.options.domButtons[btns[i]] = typeof buttons[btns[i]] === 'string' ? doc.querySelector(buttons[btns[i]]) : buttons[btns[i]];
      // Tricky way to make variable function work
      (function(action){
        if (action && this.options.domButtons[action]) {
          var _this = this;
          // For play/pause toggle button
          if (action === 'playpause') {
            this.options.domButtons[action].addEventListener('click', function(){
              _this.is('playing') ? _this.pause() : _this.play();
            });
          }
          // For other buttons
          else {
            this.options.domButtons[action].addEventListener('click', function(){
              _this[action]();
            });
          }
        }
      }).call(this, btns[i]);
    }
    
    return this;
  };

  /**
   * Reset timer state.
   *
   * @param string doit
   *   What to do with time value, possible values:
   *   + reset: reset value to min for countdowns, to max for clocks.
   *   + initial: set initial value.
   *
   * @chainable
   */
  donuttyTimer.prototype.reset = function(doit) {
    var valuereset = this.options.delta > 0 ? this.options.max : this.options.min;

    clearTimeout(this.interval);
    !this.options.callbacksafterstop && clearTimeout(this.intervaldo);

    doit === 'reset' && this.setState({value: valuereset, valuedisplay: valuereset});
    doit === 'initial' && this.setState({value: this.options.valueinitial, valuedisplay: this.options.valueinitial});
    this.$wrapper.classList.remove('dt-runout');
    this.$wrapper.classList.remove('dt-end');
    this.options.resetvalueonstart = true;
    this.was = {};
    this.updateText();

    return this;
  };

  /**
   * Run an api callback, that was set in options.
   *
   * @param string name
   *   Callback name.
   *
   * @chainable
   */
  donuttyTimer.prototype.callback = function(name) {
    if (typeof this.options.callbacks[name] === 'function') {
      this.options.callbacks[name].call(this);
    }

    return this;
  },

  /**
   * Initialize timer styles to align time (text) to the middle of container.
   *
   * Is called automatically on `init()`, normally shouldn't be used in custom
   * functions.
   *
   * @chainable
   */
  donuttyTimer.prototype.initStyles = function() {
    this.$wrapper.style.position = 'relative';

    if (this.$wrapper.donutty && this.$wrapper.donutty.$text) {
      Object.assign(
        this.$wrapper.donutty.$text.style,
        {position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)'}
      );
    }

    return this;
  };

  /**
   * Resize timer container - make it's size match donut (svg) size.
   *
   * Is called automatically on `init()`, normally shouldn't be used in custom
   * functions.
   *
   * @chainable
   */
  donuttyTimer.prototype.updateSize = function() {
    var $svg = this.$wrapper.donutty ? this.$wrapper.donutty.$svg : null;

    if ($svg) {
      var w = $svg.clientWidth
      var h = $svg.ClientHeight;

      if ((!w || !h) && this.options.radius) {
        w = 2 * this.options.radius;
        h = w;
      }

      Object.assign(
        this.$wrapper.style,
        {width: w + 'px', height: h + 'px'}
      );
    }

    this.callback('updatesize');

    return this;
  };

  /**
   * Update timer (clock face) text.
   *
   * @chainable
   */
  donuttyTimer.prototype.updateText = function() {
    var state = this.getState(),
    text = typeof this.options.gettext === 'function' ? this.options.gettext(state) : this.getText(state);
    
    this.$wrapper.donutty 
    && this.$wrapper.donutty.$text
    && (this.$wrapper.donutty.$text.innerHTML = text);
    
    return this;
  };

  /**
   * Return timer text (usually current clock/timer time).
   *
   * @param object state
   *   Current timer state.
   *
   * @return string
   *   Html code of timer text.
   */
  donuttyTimer.prototype.getText = function(state) {
    var res,
    status = this.getStatus(),
    labels = this.options.labels;

    // Set text related to current state if set
    if (labels.stop && status === 'stop') {
      res = labels.stop;
    }
    else if (labels.pause && status === 'pause') {
      res = labels.pause;
    }
    else if (labels.init && status === 'init') {
      res = labels.init;
    }
    // Set current timer time as text
    else {
      var time = this.getTime(state.valuedisplay),
      sign = state.valuedisplay < 0 ? '-' : '',
      items = [];

      // Wrap digits with tags
      for (var i in time) {
        if (time[i]) {
          items.push('<' + this.options.tag + ' class="' + i + '">' + time[i] + '</' + this.options.tag + '>');
        }
      }
      // Add digit separators
      res = items.join('<' + this.options.tag + ' class="separator">' + this.options.separator + '</' + this.options.tag + '>');
      // Add '-' sign if value is negative
      if (sign) {
        res = '<' + this.options.tag + ' class="sign">' + sign + '</' + this.options.tag + '>' + res;
      }
    }

    return res;
  };

  /**
   * Return current time fractions.
   *
   * @param int value
   *   Current time (sec).
   *
   * @return object
   *   Current time as object, that was build according
   *   to the timer options. Default format looks like:
   *   {min: '04', sec: '59'}.
   */
  donuttyTimer.prototype.getTime = function(value) {
    var time = {},
    text = {},
    data = {day: 86400, hour: 3600, min: 60, sec: 1},
    sum = 0,
    buf = 0,
    format = this.options.format;

    value = Math.abs(value);

    // Calculate days, hours, minuntes, seconds
    for (var i in data) {
      time[i] = Math.floor((value - sum) / data[i]);
      sum += time[i] * data[i];

      // Check if this fraction is included in output format
      if (truth(format[i])) {
        text[i] = time[i] + (buf ? Math.floor(buf / data[i]) : 0);
        buf = 0;
      }
      else {
        text[i] = '';
        buf += time[i] * data[i];
      }

      // Add leading zero
      text[i] = text[i].toString();
      if (i !== 'day' && text[i] !== '') {
        text[i] = text[i].padStart(2, '0');
      }
    }

    return text;
  };

  /**
   * Get current state (most useful options).
   *
   * @return object
   *   Current donutty state values like:
   *   {min: 0, max: 60, value: 50, valuedisplay: 50, bg: 'blue', color: 'red'}.
   */
  donuttyTimer.prototype.getState = function() {
    var res = this.$wrapper.donutty ? this.$wrapper.donutty.state : {};
    res.valuedisplay = this.get('valuedisplay');
    return res;
  };

  /**
   * Set multiple property new values for a state.
   *
   * @param object newState
   *   New values in {key: value} format.
   *
   * @chainable
   */
  donuttyTimer.prototype.setState = function(newState) {
    for (var i in newState) {
      this.set(i, newState[i]);
    }

    return this;
  };

  /**
   * Get current state property.
   *
   * @param string prop
   *   Property name.
   *
   * @return mixed
   *   Current value for a donutty property.
   */
  donuttyTimer.prototype.get = function(prop) {
    return this.options[prop];
  };

  /**
   * Set new property value.
   *
   * Note: if options.transitionsync is false then new value for `value`
   * property will also be set for `valuedisplay` property.
   *
   * @param string prop
   *   Property name.
   * @param mixed val
   *   New value.
   *
   * @chainable
   */
  donuttyTimer.prototype.set = function(prop, val) {
    if (isDefined(prop) && isDefined(val)) {
      this.options[prop] = val;
      this.$wrapper.donutty && this.$wrapper.donutty.set(prop, val);
      if (prop === 'value') {
        !this.is('started') && (this.options.resetvalueonstart = false);
        !this.options.transitionsync && (this.options.valuedisplay = val);
      }
    }

    return this;
  };

  /**
   * Add/substract some time from current value.
   *
   * @param int delta
   *   Number of seconds to add (can be negative).
   *
   * @chainable
   */
  donuttyTimer.prototype.adjustValue = function(delta) {
    var state = this.getState(),
    value = state.value + delta,
    valuedisplay = state.valuedisplay + delta;

    if (this.options.delta >= 0) {
      this.options.stoponend && value > state.max && (value = state.max);
      value < state.min && (value = state.min);
      this.options.stoponend && valuedisplay > state.max && (valuedisplay = state.max);
      valuedisplay < state.min && (valuedisplay = state.min);
      valuedisplay < state.max && (this.was.end = false);
      valuedisplay < this.options.runout && (this.was.runout = false);
    }
    else {
      this.options.stoponend && value < state.min && (value = state.min);
      value > state.max && (value = state.max);
      this.options.stoponend && valuedisplay < state.min && (valuedisplay = state.min);
      valuedisplay > state.max && (valuedisplay = state.max);
      valuedisplay > state.min && (this.was.end = false);
      valuedisplay > this.options.runout && (this.was.runout = false);
    }

    this.setState({value: value, valuedisplay: valuedisplay});
    !this.is('started') && (this.options.resetvalueonstart = false);
    this.updateText();

    return this;
  };

  /**
   * Check if current timer status is the same as specified.
   *
   * @param string status
   *   Status name.
   *
   * @return bool
   *   True - if current timer status matches status param,
   *   false otherwise.
   */
  donuttyTimer.prototype.is = function(status) {
    var currentStatus = this.getStatus();

    switch (status) {
      case 'started': return ['play', 'pause'].indexOf(currentStatus) >= 0;
      case 'playing': status = 'play'; break;
      case 'paused':  status = 'pause'; break;
      case 'stopped': status = 'stop'; break;
    }

    return currentStatus === status;
  };

  /**
   * Get current timer status.
   *
   * @return string
   *   Current status.
   */
  donuttyTimer.prototype.getStatus = function() {
    return this.get('status');
  };

  /**
   * Set timer status.
   *
   * Normally shouldn't be used in custom functions.
   *
   * @param string status
   *   New status name.
   *
   * @chainable
   */
  donuttyTimer.prototype.setStatus = function(status) {
    this.setState({status: status});
    this.setStatusClass(status);
    this.updateText();

    return this;
  };

  /**
   * Set class representing status to timer container and buttons.
   *
   * Normally shouldn't be used in custom functions.
   *
   * @param string status
   *   Status name.
   *
   * @chainable
   */
  donuttyTimer.prototype.setStatusClass = function(status) {
    var oldStatus = '',
    newStatus = 'dt-status-' + status;

    // Find container status class
    this.$wrapper.classList.forEach(
      function(v, k, list) {
        if (v.indexOf('dt-status-') === 0) {
          oldStatus = v;
        }
      },
      this.$wrapper
    );

    // Remove old status class and set new one
    oldStatus && this.$wrapper.classList.remove(oldStatus);
    this.$wrapper.classList.add(newStatus);

    // Copy status to buttons too
    for (var i in this.options.domButtons) {
      if (this.options.domButtons[i]) {
        oldStatus && this.options.domButtons[i].classList.remove(oldStatus);
        this.options.domButtons[i].classList.add(newStatus);
      }
    }

    return this;
  };

  /**
   * Start the timer (reset some values and start playing).
   *
   * @chainable
   */
  donuttyTimer.prototype.start = function() {
    if (this.is('started')) {
      return this;
    }

    var _this = this;

    this.options.resetvalueonstart && this.setState({value: this.options.valueinitial, valuedisplay: this.options.valueinitial});
    this.options.resetvalueonstart = true;
    this.setStatus('play');
    this.interval = setTimeout(function(){_this.tick();}, this.options.speed - this.getTransitionDuration());
    this.callback('start');

    return this;
  };

  /**
   * Make the timer ticking (calc data to change current time).
   *
   * Normally shouldn't be used in custom functions.
   *
   * @chainable
   */
  donuttyTimer.prototype.tick = function() {
    if (this.is('stopped')) {
      return this;
    }

    var _this = this,
    state = this.getState(),
    newValue = state.value + this.options.delta,
    doStop = false,
    doEnd = false,
    duration = this.getTransitionDuration();

    if (!this.is('playing')) {
      this.interval = setTimeout(function(){_this.tick();}, this.options.speed);
      return this;
    }

    // Don't allow values that goes beyond max/min
    if (this.options.delta >= 0 && newValue >= state.max) {
      doEnd = true;
      if (this.options.stoponend) {
        newValue = state.max;
        doStop = true;
      }
    }
    else if (this.options.delta < 0 && newValue <= state.min) {
      doEnd = true;
      if (this.options.stoponend) {
        newValue = state.min;
        doStop = true;
      }
    }

    // Save new time value
    this.set('value', newValue);
    !doEnd ? null : this.was.end ? (doEnd = false) : (this.was.end = true);
    
    duration > 0 ? (this.intervaldo = setTimeout(function(){_this.doTick(doEnd, doStop);}, duration)) : this.doTick(doEnd, doStop);
    this.interval = setTimeout(function(){_this.tick();}, this.options.speed);
    
    return this;
  };

  /**
   * Change current time on clock face (and run callbacks).
   *
   * Normally shouldn't be used in custom functions.
   *
   * @param bool doEnd
   *   True - time is up.
   * @param bool doStop
   *   True - stop timer.
   *
   * @chainable
   */
  donuttyTimer.prototype.doTick = function(doEnd, doStop) {
    var newValue = this.get('value');
    
    this.set('valuedisplay', newValue);
    this.updateText();
    this.callback('tick');

    // Add special class when time is running out
    if (this.options.runout) {
      if (this.options.delta >= 0 && newValue >= this.options.runout
          || this.options.delta < 0 && newValue <= this.options.runout) {
        this.$wrapper.classList.add('dt-runout');
        !this.was.runout && this.callback('runout');
        this.was.runout = true;
      }
      else {
        this.$wrapper.classList.remove('dt-runout');
        this.was.runout = false;
      }
    }

    // Callback if time is over
    doEnd && (this.callback('end'), this.$wrapper.classList.add('dt-end'));
    // Stop if should stop on time over
    doStop && this.stop();

    return this;
  };

  /**
   * Pause the timer.
   *
   * @chainable
   */
  donuttyTimer.prototype.pause = function() {
    if (!this.is('playing')) {
      return this;
    }

    this.setStatus('pause');
    this.callback('pause');

    return this;
  };

  /**
   * Start the timer or continue ticking (after pause).
   *
   * @chainable
   */
  donuttyTimer.prototype.play = function() {
    if (!this.is('started')) {
      this.start();
    }
    else {
      this.setStatus('play');
      this.callback('play');
    }

    return this;
  };

  /**
   * Stop the timer (reset and finish any activity).
   *
   * @chainable
   */
  donuttyTimer.prototype.stop = function() {
    if (this.is('stopped')) {
      return;
    }

    this.reset(this.options.valueonstop);
    this.setStatus('stop');
    this.callback('stop');

    return this;
  };

}(document, window));


/**
 * Auto initialize timers for containers that have
 * 'data-donutty-timer' attribute.
 */
(function(DonuttyTimer, doc) {
  var init = function() {
    var $timers = doc.querySelectorAll('[data-donutty-timer]');

    Array.prototype.forEach.call($timers, function($el){
      new DonuttyTimer($el, null);
    });
  };

  if (doc.readyState === 'complete' || (doc.readyState !== 'loading' && !doc.documentElement.doScroll)) {
    init();
  } else {
    doc.addEventListener('DOMContentLoaded', init);
  }
}(DonuttyTimer, document));
