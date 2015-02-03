module.exports = function (grunt) {

    require('load-grunt-tasks')(grunt);
    grunt.loadNpmTasks('grunt-karma');

    // Project configuration.
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        env: grunt.file.readJSON('grunt-tasks/env/dev.json')//default environment variable
    });


    grunt.task.loadTasks("grunt-tasks");
};
