(function () {
    'use strict';


    define([
        'angular',
        'home/home-ctrl',
        'login/login-ctrl',
        'about/about-module',
        'services/login-service',
        'bootstrap',
        'jmpress',
        'angular-ui-router',
        'angular-animate'
    ], function (angular, HomeController, LoginCtrl, aboutModule, loginService) {

        var app = angular.module('myApp', ['ui.router', 'ngAnimate', aboutModule.moduleName]);
        app.init = function () {
            angular.bootstrap(document, ['myApp']);
        };

        app.service("LoginService", loginService);
        app.controller("HomeCtrl", HomeController);
        app.controller("LoginCtrl", LoginCtrl);


        app.config(function ($stateProvider, $urlRouterProvider, $locationProvider) {
            $urlRouterProvider.otherwise('about');
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