/**
 * Created by mcsere on 1/15/15.
 */
(function () {
    'use strict';
    define([], function () {
        var HomeController = function ($scope) {
            $scope.welcome = "You are not authorized.";
        };

        return ["$scope", HomeController];
    });
}());