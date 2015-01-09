module.exports = function (grunt) {

    grunt.registerTask('hi', ['env:prod','copy']);
};