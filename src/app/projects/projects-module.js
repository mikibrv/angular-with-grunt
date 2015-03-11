(function () {
    'use strict';

    define([
        'angular',
        'angular-ui-router',
        'projects/projects-ctrl'
    ], function (angular, angularUi, projectsCtrl) {
        var module = { moduleName: 'ui-projects'};
        var projects = angular.module(module.moduleName, []);


        projects.controller("ProjectsCtrl", projectsCtrl);
        projects.config(function ($stateProvider, $urlRouterProvider) {
            $stateProvider
                .state('projects', {
                    url: "/projects",
                    templateUrl: "app/projects/projects.html",
                    controller: "ProjectsCtrl"
                });
        });


        return module;
    });

}());