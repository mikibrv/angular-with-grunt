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
                src: ['app/static/**.js']
            }
        }
    });
    grunt.registerTask('code-hint', ["jshint"]);
};