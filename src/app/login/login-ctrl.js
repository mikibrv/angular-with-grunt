/**
 * Created by mcsere on 1/15/15.
 */
(function () {
    'use strict';
    define([], function () {
        var LoginCtrl = function ($scope, loginService) {
            $scope.welcome = "You are not authorized.";
        };

        return ["$scope", "LoginService", LoginCtrl];
    });
}());