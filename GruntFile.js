module.exports = function (grunt) {

    // Project configuration.
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        env: grunt.file.readJSON('grunt-tasks/env/dev.json')//default environment variable
    });
    require('load-grunt-tasks')(grunt);
    grunt.task.loadTasks("grunt-tasks");
};
