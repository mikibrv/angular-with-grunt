/**
 * Created by mcsere on 1/9/15.
 */

module.exports = function (grunt) {
    grunt.config('jshint', {
        jshint: {
            options: {
                reporter: require('jshint-stylish')
            },
            files: {
                src: ['src/static/js/**/*.js', 'src/app/**/*.js']
            }
        }
    });
};