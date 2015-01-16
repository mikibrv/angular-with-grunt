/**
 * Created by mcsere on 1/9/15.
 */

module.exports = function (grunt) {
    grunt.config('jshint', {
        jshint: {
            options: {
                reporter: require('jshint-stylish'),
                "globals": {
                    /* MOCHA */
                    "describe": false,
                    "it": false,
                    "before": false,
                    "beforeEach": false,
                    "after": false,
                    "afterEach": false,
                    "define": false
                }
            },
            files: {
                src: ['src/static/js/**/*.js', 'src/app/**/*.js']
            }
        }
    });
};