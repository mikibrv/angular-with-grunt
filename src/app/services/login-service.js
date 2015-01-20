/**
 * Created by mcsere on 1/15/15.
 */
(function () {
    'use strict';
    define([], function () {
        var Login = function ($timeout) {
            var currentObject = this;
            this.observingForms = [];

            this.showForm = function () {
                this.changeState(true, 1000);
            };
            this.hideForm = function () {
                this.changeState(false, 0);
            };

            this.changeState = function (state, timeout) {
                $timeout(function () {
                    angular.forEach(currentObject.observingForms, function (callback) {
                        callback(state);//delaying 1000 ms
                    });
                }, timeout);
            }
            this.registerForm = function (callback) {
                this.observingForms.push(callback);
            }


        };
        return  Login;
    });
}());