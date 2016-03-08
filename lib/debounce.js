'use strict';

module.exports =
function debounce(func) {
  let waiting = [];
  let running = [];

  let execute = function() {
    if (waiting.length == 0 || running.length > 0) return;

    running = waiting;
    waiting = [];
    func(function() {
      let callbackArguments = arguments;
      running.forEach(function(callback) {
        callback.apply(null, callbackArguments);
      });
      running = [];
      execute();
    });
  };

  return function(callback) {
    if (!callback) callback = function() {};
    waiting.push(callback);
    execute();
  };
};
