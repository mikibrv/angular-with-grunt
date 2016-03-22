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
                .state('resume.it-knowledge', {
                    url: "/technical-knowledge",
                    templateUrl: "app/resume/nested/it-knowledge.html",
                    controller: "ResumeCtrl"
                })
                .state('resume.experience', {
                    url: "/experience",
                    templateUrl: "app/resume/nested/experience.html",
                    controller: "ResumeCtrl"
                })
                .state('resume.netcentric', {
                    url: "/software-engineer-netcentric",
                    templateUrl: "app/resume/nested/exp-netcentric.html",
                    controller: "ResumeCtrl"
                })
                .state('resume.sharalike', {
                    url: "/back-end-developer-sharalike",
                    templateUrl: "app/resume/nested/exp-sharalike.html",
                    controller: "ResumeCtrl"
                })
                .state('resume.townite', {
                    url: "/townite-java-developer",
                    templateUrl: "app/resume/nested/exp-townite.html"
                })
                .state('resume.ebooking', {
                    url: "/ebooking-java-developer",
                    templateUrl: "app/resume/nested/exp-ebooking.html"
                })
                .state('resume.abcroisiere', {
                    url: "/ecommerce-java-developer",
                    templateUrl: "app/resume/nested/exp-abcroisiere.html"
                })
                .state('resume.internships', {
                    url: "/internship-coordinator",
                    templateUrl: "app/resume/nested/exp-internships.html"
                })
                .state("resume.teacher", {
                    url: "/web-development-teacher",
                    templateUrl: "app/resume/nested/exp-teaching.html"
                })
                .state("resume.freelancer", {
                    url: "/freelancer",
                    templateUrl: "app/resume/nested/exp-freelancer.html"
                })
                .state("resume.tech", {
                    url: "/tech-support",
                    templateUrl: "app/resume/nested/exp-tech-support.html"
                })
                .state('resume.knowledge-sharing', {
                    url: "/knowledge-sharing",
                    templateUrl: "app/resume/nested/ks.html",
                    controller: "ResumeCtrl"
                })
                .state('resume.education', {
                    url: "/education",
                    templateUrl: "app/resume/nested/education.html",
                    controller: "ResumeCtrl"
                })
                .state('resume.all-in-one', {
                    url: "/one-page",
                    templateUrl: "app/resume/nested/all-in-one.html",
                    controller: "ResumeCtrl"
                })
                .state('resume.others', {
                    url: "/{path:.*}",
                    templateUrl: "app/resume/nested/all-in-one.html",
                    controller: "ResumeCtrl"
                })
            ;
        });


        return module;
    });

}());