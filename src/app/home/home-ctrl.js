/**
 * Created by mcsere on 1/15/15.
 */
(function () {
    'use strict';
    define([], function () {
        var HomeController = function ($scope, $http, loginService) {
            $scope.welcome = "";
            // Simple GET request example :
            $http.get('http://api.icndb.com/jokes/random').
                success(function (data, status, headers, config) {
                    $scope.welcome = data.value.joke;
                }).
                error(function (data, status, headers, config) {
                    // called asynchronously if an error occurs
                    // or server returns response with an error status.
                });
        };

        return ["$scope", "$http", "LoginService", HomeController];
    });
}());