/**
 * Created by mcsere on 1/15/15.
 */
(function () {
    'use strict';
    define([], function () {
        var LoginCtrl = function ($scope, loginService) {
            $scope.welcome = "You are not authorized.";
            loginService.registerForm(function (command) {
                $scope.showLogin = command;
            });
            $scope.$on('$locationChangeStart', function (event, next, current) {
                loginService.hideForm();
            });

        };

        return ["$scope", "LoginService", LoginCtrl];
    });
}());