(function () {
    'use strict';


    define([
        'angular',
        'home/home-ctrl',
        'about/about-module',
        'bootstrap',
        'jmpress',
        'angular-ui-router',
        'angular-animate'
    ], function (angular, HomeController, aboutModule) {

        var app = angular.module('myApp', ['ui.router', 'ngAnimate', aboutModule.moduleName]);
        app.init = function () {
            angular.bootstrap(document, ['myApp']);
        };

        app.controller("HomeCtrl", HomeController);


        app.config(function ($stateProvider, $urlRouterProvider, $locationProvider) {
            $urlRouterProvider.otherwise('/');
            $urlRouterProvider.when("", '/');

            $locationProvider
                .hashPrefix('!');

            $stateProvider
                .state('home', {
                    url: "/",
                    controller: "HomeCtrl",
                    templateUrl: "app/home/home.html"
                });
        });


        return app;
    });
}());