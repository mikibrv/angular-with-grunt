var tests = [];
for (var file in window.__karma__.files) {
    if (window.__karma__.files.hasOwnProperty(file)) {
        if (/Spec\.js$/.test(file)) {
            tests.push(file);
        }
    }
}

requirejs.config({
    // Karma serves files from '/base'
    baseUrl: '/base/src/app/',

    paths: {
        'angular': '../static/vendor/angular/angular.min',
        'angular-ui-router': '../static/vendor/angular-ui-router/release/angular-ui-router.min',
        'angular-animate': '../static/vendor/angular-animate/angular-animate.min',
        'angular-mock': '../../node_modules/angular-mocks/angular-mocks',

        /* external non angular dependencies*/


        'jQuery': '../static/vendor/jquery/dist/jquery.min',
        'bootstrap': '../static/vendor/bootstrap/dist/js/bootstrap.min',
        'jmpress': '../static/vendor/jmpress/jmpress',
        'underscore': '../static/vendor/underscore/underscore-min',
        'vis': '../static/vendor/vis/dist/vis.min'
    },
    shim: {
        'angular-ui-router': {
            deps: ['angular']
        },
        'angular-mock': {
            deps: ['angular']
        },
        angular: {
            exports: 'angular'
        },
        'angular-animate': {
            deps: ['angular']
        },
        'angular-mocks': {
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
    },

    // ask Require.js to load these files (all our tests)
    deps: tests,

    // start test run, once Require.js is done
    callback: window.__karma__.start
});