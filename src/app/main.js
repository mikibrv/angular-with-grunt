/**
 *
 */
require.config({
    baseUrl: "app",
    //ceva
    paths: {
        'angular': '../static/vendor/angular/angular.min',
        'angular-ui-router': '../static/vendor/angular-ui-router/release/angular-ui-router.min',
        'angular-animate': '../static/vendor/angular-animate/angular-animate.min',

        /* external non angular dependencies*/

        'jQuery': '../static/vendor/jquery/dist/jquery.min',
        'bootstrap': '../static/vendor/bootstrap/dist/js/bootstrap.min',
        'jmpress': '../static/vendor/jmpress/jmpress',
        'underscore': '../static/vendor/underscore/underscore-min'
    },
    shim: {
        'angular-ui-router': {
            deps: ['angular']
        },
        angular: {
            exports: 'angular'
        },
        'angular-animate': {
            deps: ['angular']
        },

        /* jQuery & BooStrap*/
        jQuery: {
            exports: 'jQuery'
        },
        bootstrap: {
            deps: ['jQuery'],
            exports: 'bootstrap'
        },
        jmpress: {
            deps: ['jQuery', 'underscore'],
            exports: 'jmpress'
        }
    }
});

require(['app'], function (app) {
    app.init();
});