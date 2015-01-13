require.config({
    baseUrl: "app",
    //ceva
    paths: {
        'angular': '../static/vendor/angular/angular.min',
        'angularUIRouter': '../static/vendor/angular-ui-router/release/angular-ui-router.min',

        'jQuery': '../static/vendor/jquery/dist/jquery.min',
        'bootstrap': '../static/vendor/bootstrap/dist/js/bootstrap.min'
    },
    shim: {
        angularUIRouter: {
            deps: ['angular'],
            exports: 'angular'
        },
        angular: {
            exports: 'angular'
        },

        /* jQuery & BooStrap*/
        jQuery: {
            exports: 'jQuery'
        },
        bootstrap: {
            deps: ['jQuery'],
            exports: 'bootstrap'
        }
    }
});

require(['app'], function (app) {
    app.init();
});