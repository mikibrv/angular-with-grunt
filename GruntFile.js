module.exports = function (grunt) {

    // Project configuration.
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        env: {
            options: {
                //Shared Options Hash
            },
            dev: {
                src: "grunt-tasks/env/dev.json"
            },
            prod: {
                src: "grunt-tasks/env/prod.json"
            }
        }

    });
    require('load-grunt-tasks')(grunt);
    grunt.task.loadTasks("grunt-tasks");
};
