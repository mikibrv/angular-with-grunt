/**
 * Created by Miki on 3/1/15.
 */
(function () {
    'use strict';

    define([], function () {
        var Notification = function ($timeout) {
            return {restrict: 'E',
                replace: true,
                link: function (scope, element, attrs) {
                    $timeout(function () {
                        element.remove();
                    }, 5000);
                }
            }
        };
        return ["$timeout", Notification];
    });
}());
