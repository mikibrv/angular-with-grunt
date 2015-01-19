/**
 * Created by mcsere on 1/15/15.
 */
(function () {
    'use strict';
    define([], function () {
        var AboutCtrl = function ($scope, $http) {
            $scope.data = "You are not authorized.";

        };


        return ["$scope","$http", AboutCtrl];
    });
}());