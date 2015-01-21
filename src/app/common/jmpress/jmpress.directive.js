(function () {
    'use strict';

    define(['jmpress'], function (jmpress) {


        var initDirective = function (element) {
            $.jmpress("initStep", function (step, eventData) {
                eventData.stepData.up = eventData.data.up;
                eventData.stepData.down = eventData.data.down;
            });
            try {
                $.jmpress("register", "up", function () {
                    var stepData = element.jmpress("active").data("stepData");
                    if (stepData.up)
                        element.jmpress("select", stepData.up);
                });
                $.jmpress("register", "down", function () {
                    var stepData = element.jmpress("active").data("stepData");
                    if (stepData.down)
                        element.jmpress("select", stepData.down);
                });
            }catch(e){
                //prevented double init
            }
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
        };


        /**
         * Required for the angular directive;
         * @returns {{restrict: string, scope: boolean, link: link}}
         */
        var jmPress = function ($timeout) {
            return {
                restrict: 'A',
                scope: false,
                link: function ($scope, $element) {
                    $timeout(function () {
                        initDirective($($element));
                    }, 100);

                }
            };
        };
        return ["$timeout", jmPress];

    });
}());