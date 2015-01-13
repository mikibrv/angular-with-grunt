/**
 * Custom function made to read from env/*json environment variables
 * Created by mcsere on 1/9/15.
 */
module.exports = function (grunt) {
    grunt.registerTask('env', function (key) {
        var envFile = "grunt-tasks/env/" + key + ".json";
        if (!grunt.file.exists(envFile)) {
            grunt.log.error("Environment " + key + " not found. Please check: " + envFile);
            return true;//return false to abort the execution
        }
        var env = grunt.file.readJSON(envFile);
        grunt.config.set("env", env);
        return true;
    });
};