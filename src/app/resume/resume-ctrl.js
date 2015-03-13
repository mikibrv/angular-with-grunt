/**
 * Created by mcsere on 1/15/15.
 */
(function () {
    'use strict';
    define([], function () {
        var resumeCtrl = function ($scope, $http) {

            $scope.innerBoxImage = "static/img/software-dev.jpg";

        };


        return ["$scope", "$http", resumeCtrl];
    });
}());