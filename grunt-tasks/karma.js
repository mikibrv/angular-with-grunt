/**
 * Created by mcsere on 1/9/15.
 */

module.exports = function (grunt) {
    grunt.config('karma', {
        unit: {
            configFile: 'grunt-tasks/karma/karma.conf.js'
        }
    });

    grunt.registerTask("test", ["deploy:dev","karma"])
};