define(function (require) {
    'use strict';
    require('jQuery');
    var angular = require('angular');
    var angularRouter = require('angularUIRouter');

    var app = angular.module('myApp', []);

    app.controller('GreetingController', ['$scope', function($scope) {
        $scope.greeting = 'Hola!';
    }]);

    app.init = function () {
        angular.bootstrap(document, ['myApp']);
    };
    return app;
});
