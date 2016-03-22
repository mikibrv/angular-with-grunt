(function () {
    'use strict';

    define(['vis'], function (vis) {

        var initDirective = function ($element) {
            var nodes = [];
            var edges = [];
            var connectionCount = [];

            var from,to;

            // randomly create some nodes and edges
            var nodeCount = 20;
            for (var i = 0; i < nodeCount; i++) {
                nodes.push({
                    id: i,
                    label: ""
                });

                connectionCount[i] = 0;

                // create edges in a scale-free-network way
                if (i == 1) {
                    from = i;
                    to = 0;
                    edges.push({
                        from: from,
                        to: to
                    });
                    connectionCount[from]++;
                    connectionCount[to]++;
                }
                else if (i > 1) {
                    var conn = edges.length * 2;
                    var rand = Math.floor(Math.random() * conn);
                    var cum = 0;
                    var j = 0;
                    while (j < connectionCount.length && cum < rand) {
                        cum += connectionCount[j];
                        j++;
                    }

                    from = i;
                    to = j;
                    edges.push({
                        from: from,
                        to: to
                    });
                    connectionCount[from]++;
                    connectionCount[to]++;
                }
            }

            // create a network
            var clusteringOn = false;
            var clusterEdgeThreshold = 10;
            var container = document.getElementById('graph');
            var data = {
                nodes: nodes,
                edges: edges
            };
            var options = {
                style: 'surface',
                showPerspective: true,
                clustering: {
                    enabled: clusteringOn,
                    clusterEdgeThreshold: clusterEdgeThreshold
                },
                stabilize: false,
                zoomable: false,
                dragNetwork: false

            };
           new vis.Network(container, data, options);

        };


        /**
         * Required for the angular directive;
         * @returns {{restrict: string, scope: boolean, link: link}}
         */
        var graph = function ($timeout) {
            return {
                restrict: 'A',
                scope: false,
                link: function ($scope, $element) {
                    $timeout(function () {
                        initDirective($element);
                    }, 1000);
                }
            };
        };
        return ["$timeout", graph];

    });
}());