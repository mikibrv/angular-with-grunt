(function () {
    'use strict';

    define([
        'angular',
        'angular-ui-router',
        'resume/resume-ctrl'
    ], function (angular, angularUi, resumeCtrl) {
        var module = {moduleName: 'ui-projects'};
        var projects = angular.module(module.moduleName, []);


        projects.controller("ResumeCtrl", resumeCtrl);
        projects.config(function ($stateProvider, $urlRouterProvider) {
            $stateProvider
                .state('resume', {
                    url: "/resume",
                    templateUrl: "app/resume/resume.html",
                    controller: "ResumeCtrl"
                })
                .state('resume.contact', {
                    url: "/contact",
                    templateUrl: "app/resume/nested/contact.html",
                    controller: "ResumeCtrl"
                })
                .state('resume.others', {
                    url: "/{path:.*}",
                    template: "404",
                    controller: "ResumeCtrl"
                })
            ;
        });


        return module;
    });

}());