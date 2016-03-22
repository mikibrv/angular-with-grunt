/**
 * Created by Miki on 3/1/15.
 */
(function () {
    'use strict';

    define(['jmpress'], function (jmpress) {

        /**
         * @param element
         * @constructor
         */
        var Slider = function (element) {
            this.element = element;
            this.deinitDirective = function () {
                element.jmpress("deinit");
            };
            this.initDirective = function () {
                element.jmpress({
                    stepSelector: 'section',
                    hash: false
                });
            };
            this.go = function (where) {
                element.jmpress(where);
            };
        };

        /**
         * Required for the angular directive;
         * @returns {{restrict: string, scope: boolean, link: link}}
         */
        var jmPress = function ($timeout) {
            var slider;
            return {
                restrict: 'A',
                scope: false,
                link: function ($scope, $element) {

                    $timeout(function () {
                        slider = new Slider($($element));
                        slider.initDirective();
                    }, 200);

                    $scope.$on('$destroy', function () {
                        slider.deinitDirective();
                    });

                    $scope.go = function (where, $event) {
                        slider.go(where);
                        if (event) {
                            event.stopPropagation();
                            event.preventDefault();
                        }
                    };
                }
            };
        };
        return ["$timeout", jmPress];

    });
}());