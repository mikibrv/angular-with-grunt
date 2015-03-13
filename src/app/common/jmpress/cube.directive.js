(function () {
    'use strict';

    define(['jmpress'], function (jmpress) {

        /**
         * @param element
         * @constructor
         */
        var Cube = function (element) {
            this.element = element;
            this.deinitDirective = function () {
                element.jmpress("deinit");
            };
            this.initDirective = function () {
                $.jmpress("initStep", function (step, eventData) {
                    eventData.stepData.up = eventData.data.up;
                    eventData.stepData.down = eventData.data.down;
                });

                element.jmpress({
                    stepSelector: 'section',
                    hash: false,
                    viewPort: {
                        width: 2000,
                        height: 2000
                    },
                    keyboard: {
                        keys: {
                            38: "up",
                            40: "down"
                        }
                    }
                });
                element.jmpress("route", ["#left", "#front"]);
                element.jmpress("route", ["#top", "#right"], true);
                element.jmpress("route", ["#top", "#left"], true, true);
                element.jmpress("route", ["#bottom", "#left"], true, true);
                element.jmpress("route", ["#bottom", "#right"], true);

                element.jmpress("register", "up", function () {
                    var stepData = element.jmpress("active").data("stepData");
                    if (stepData.up)
                        element.jmpress("select", stepData.up);
                });
                element.jmpress("register", "down", function () {
                    var stepData = element.jmpress("active").data("stepData");
                    if (stepData.down)
                        element.jmpress("select", stepData.down);
                });

                element.css("display", "block");
                element.jmpress("next");
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
            var cube;
            return {
                restrict: 'A',
                scope: false,
                link: function ($scope, $element) {
                    $timeout(function () {
                        cube = new Cube($($element));
                        cube.initDirective();
                    }, 100);
                    $scope.$on('$destroy', function () {
                        cube.deinitDirective();
                    });

                    $scope.go = function (where, $event) {
                        cube.go(where);
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