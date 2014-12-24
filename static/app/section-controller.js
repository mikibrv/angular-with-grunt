angular.module('cvApp', [])
    .controller('SectionController', ['$scope', '$http', function ($scope, $http) {
        $scope.todos = [
            {text: 'learn angular', done: true},
            {text: 'build an angular app', done: false}
        ];

        $http.get('static/app/data/tech.json').
            success(function (data, status, headers, config) {
                $scope.techs = data;
            }).
            error(function (data, status, headers, config) {
                // log error
            });
    }]);