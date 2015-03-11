/**
 * Created by mcsere on 1/15/15.
 */
(function () {
    'use strict';
    define([], function () {
        var projectsCtrl = function ($scope, $http) {

            $scope.innerBoxImage = "static/img/software-dev.jpg";

        };


        return ["$scope", "$http", projectsCtrl];
    });
}());