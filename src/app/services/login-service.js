/**
 * Created by mcsere on 1/15/15.
 */
(function () {
    'use strict';
    define([], function () {
        var Login = function ($timeout, $location) {
            var currentObject = this;
            this.observingForms = [];

            this.showForm = function () {
                this.changeState(true, 1000, $location.path());
            };
            this.hideForm = function () {
                this.changeState(false, 100, $location.path());
            };

            this.changeState = function (state, timeout, path) {
                $timeout(function () {
                    if ($location.path() === path) {//if location has changed we don't do it
                        angular.forEach(currentObject.observingForms, function (callback) {
                            callback(state);
                        });
                    }
                }, timeout);
            };
            this.registerForm = function (callback) {
                this.observingForms.push(callback);
            }


        };
        return  Login;
    });
}());