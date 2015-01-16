(function () {
    'use strict';
    var dependencies = [
        'jmpress'
    ];

    define(dependencies, function (jmpress) {

        var jmPress = function () {
            return {
                restrict: 'A',
                scope: false,
                link: function ($scope, $element) {
                    var init = $scope.$watch('data', function (data) {
                        if (data) {
                            $scope.$evalAsync(function () {
                                $($element).jmpress({
                                    hash: {
                                        use: false
                                    }
                                });
                                init();
                            });
                        }
                    });
                }
            };
        };
        return [ jmPress];

    });
}());