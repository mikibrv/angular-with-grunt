/**
 * Created by mcsere on 1/15/15.
 */
(function () {
    'use strict';
    define([], function () {
        var HomeController = function ($scope, loginService) {
            $scope.welcome = "You are not authorized.";
            loginService.showForm();
        };

        return ["$scope", "LoginService", HomeController];
    });
}());