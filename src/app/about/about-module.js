(function () {
    'use strict';

    define([
        'angular',
        'angular-ui-router',
        '../common/jmpress/jmpress.directive',
        'about/about-ctrl'
    ], function (angular,angularUi,
                                   jmpress, aboutCtrl) {
        var module = { moduleName: 'ui-about'};
        var about = angular.module(module.moduleName, []);


        about.controller("AboutCtrl", aboutCtrl);

        about.directive('uiImpress', jmpress);


        about.config(function ($stateProvider, $urlRouterProvider) {
            $stateProvider
                .state('about', {
                    url: "/about",
                    templateUrl: "app/about/about.html",
                    controller: "AboutCtrl"
                });
        });


        return module;
    });


}());